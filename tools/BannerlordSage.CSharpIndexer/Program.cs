using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: dotnet run --project tools/BannerlordSage.CSharpIndexer -- <sourceDir> <outputJsonPath> [--file-list <path>]");
    return 1;
}

var sourceDir = Path.GetFullPath(args[0]);
var outputPath = Path.GetFullPath(args[1]);
string? fileListPath = null;

for (var i = 2; i < args.Length; i += 1)
{
    if (string.Equals(args[i], "--file-list", StringComparison.OrdinalIgnoreCase))
    {
        if (i + 1 >= args.Length)
        {
            Console.Error.WriteLine("Missing value for --file-list");
            return 1;
        }

        fileListPath = Path.GetFullPath(args[i + 1]);
        i += 1;
        continue;
    }

    Console.Error.WriteLine($"Unknown argument: {args[i]}");
    return 1;
}

if (!Directory.Exists(sourceDir))
{
    Console.Error.WriteLine($"Source directory does not exist: {sourceDir}");
    return 1;
}

if (fileListPath is not null && !File.Exists(fileListPath))
{
    Console.Error.WriteLine($"File list does not exist: {fileListPath}");
    return 1;
}

var files = fileListPath is null
    ? Directory.EnumerateFiles(sourceDir, "*.cs", SearchOption.AllDirectories)
        .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
        .ToList()
    : await ProgramHelpers.LoadFileListAsync(sourceDir, fileListPath);

var payload = new IndexPayload();
payload.IndexedFiles.AddRange(files.Select(path => ProgramHelpers.NormalizeRelativePath(sourceDir, path)));

foreach (var filePath in files)
{
    var sourceText = await File.ReadAllTextAsync(filePath);
    var tree = CSharpSyntaxTree.ParseText(sourceText, path: filePath);
    var root = await tree.GetRootAsync();

    payload.FilesScanned += 1;
    var walker = new IndexWalker(filePath, tree, payload);
    walker.Visit(root);
}

var options = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = true
};

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(payload, options));
return 0;

internal sealed class IndexPayload
{
    public int FilesScanned { get; set; }
    public List<string> IndexedFiles { get; } = [];
    public List<TypeRecord> Types { get; } = [];
    public List<MemberRecord> Members { get; } = [];
    public List<SourceLocalizationRecord> SourceLocalizations { get; } = [];
}

internal sealed class TypeRecord
{
    public required string TypeName { get; init; }
    public required string FullName { get; init; }
    public required string NamespaceName { get; init; }
    public string? ContainingType { get; init; }
    public required string FilePath { get; init; }
    public required int StartLine { get; init; }
    public required int EndLine { get; init; }
    public required string TypeKind { get; init; }
    public required string Accessibility { get; init; }
    public required string Modifiers { get; init; }
}

internal sealed class MemberRecord
{
    public required string Id { get; init; }
    public required string TypeFullName { get; init; }
    public required string MemberName { get; init; }
    public required string MemberKind { get; init; }
    public required string Signature { get; init; }
    public string? ReturnType { get; init; }
    public required string FilePath { get; init; }
    public required int StartLine { get; init; }
    public required int EndLine { get; init; }
    public required string Accessibility { get; init; }
    public required bool IsStatic { get; init; }
}

internal sealed class SourceLocalizationRecord
{
    public required string StringId { get; init; }
    public required string FallbackText { get; init; }
    public required string NormalizedFallback { get; init; }
    public required string FilePath { get; init; }
    public required string ModuleName { get; init; }
    public required string AssemblyName { get; init; }
    public string? TypeFullName { get; init; }
    public string? MemberName { get; init; }
    public required int LineNumber { get; init; }
    public required int ColumnNumber { get; init; }
    public required string ContextKind { get; init; }
    public required int SourcePriority { get; init; }
    public required string RawLiteral { get; init; }
}

internal sealed class IndexWalker : CSharpSyntaxWalker
{
    private static readonly Regex LocalizationTokenRegex = new(@"^\{=([^}]+)\}(.*)$", RegexOptions.Singleline | RegexOptions.Compiled);
    private readonly string _filePath;
    private readonly SyntaxTree _tree;
    private readonly IndexPayload _payload;
    private readonly string _moduleName;
    private readonly string _assemblyName;
    private readonly Stack<string> _typeStack = new();
    private readonly Stack<string> _namespaceStack = new();

    public IndexWalker(string filePath, SyntaxTree tree, IndexPayload payload)
        : base(SyntaxWalkerDepth.StructuredTrivia)
    {
        _filePath = filePath;
        _tree = tree;
        _payload = payload;
        (_moduleName, _assemblyName) = InferSourceOrigin(filePath);
    }

    public override void VisitNamespaceDeclaration(NamespaceDeclarationSyntax node)
    {
        _namespaceStack.Push(node.Name.ToString());
        base.VisitNamespaceDeclaration(node);
        _namespaceStack.Pop();
    }

    public override void VisitFileScopedNamespaceDeclaration(FileScopedNamespaceDeclarationSyntax node)
    {
        _namespaceStack.Push(node.Name.ToString());
        base.VisitFileScopedNamespaceDeclaration(node);
        _namespaceStack.Pop();
    }

    public override void VisitClassDeclaration(ClassDeclarationSyntax node) => VisitNamedType(node, "class");
    public override void VisitStructDeclaration(StructDeclarationSyntax node) => VisitNamedType(node, "struct");
    public override void VisitInterfaceDeclaration(InterfaceDeclarationSyntax node) => VisitNamedType(node, "interface");
    public override void VisitEnumDeclaration(EnumDeclarationSyntax node) => VisitNamedType(node, "enum");
    public override void VisitRecordDeclaration(RecordDeclarationSyntax node) => VisitNamedType(node, "record");

    public override void VisitMethodDeclaration(MethodDeclarationSyntax node)
    {
        AddMember(
            node,
            node.Identifier.Text,
            "method",
            node.ReturnType.ToString(),
            BuildMethodSignature(node),
            node.Modifiers
        );
        base.VisitMethodDeclaration(node);
    }

    public override void VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
    {
        AddMember(
            node,
            node.Identifier.Text,
            "constructor",
            null,
            BuildConstructorSignature(node),
            node.Modifiers
        );
        base.VisitConstructorDeclaration(node);
    }

    public override void VisitLiteralExpression(LiteralExpressionSyntax node)
    {
        TryAddSourceLocalization(node);
        base.VisitLiteralExpression(node);
    }

    private void VisitNamedType(MemberDeclarationSyntax node, string typeKind)
    {
        var identifier = node switch
        {
            BaseTypeDeclarationSyntax baseType => baseType.Identifier.Text,
            _ => "UnknownType"
        };

        var containingType = _typeStack.Count > 0 ? string.Join(".", _typeStack.Reverse()) : null;
        var namespaceName = _namespaceStack.Count > 0 ? string.Join(".", _namespaceStack.Reverse()) : string.Empty;
        var fullName = string.Join(".",
            new[] { namespaceName, containingType, identifier }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        var lineSpan = _tree.GetLineSpan(node.Span);
        var modifiers = node switch
        {
            BaseTypeDeclarationSyntax baseType => baseType.Modifiers.ToString(),
            _ => string.Empty
        };

        _payload.Types.Add(new TypeRecord
        {
            TypeName = identifier,
            FullName = fullName,
            NamespaceName = namespaceName,
            ContainingType = containingType,
            FilePath = _filePath,
            StartLine = lineSpan.StartLinePosition.Line,
            EndLine = lineSpan.EndLinePosition.Line,
            TypeKind = typeKind,
            Accessibility = GetAccessibility(modifiers),
            Modifiers = modifiers
        });

        _typeStack.Push(identifier);
        foreach (var child in node.ChildNodes())
        {
            Visit(child);
        }
        _typeStack.Pop();
    }

    private void AddMember(
        MemberDeclarationSyntax node,
        string name,
        string memberKind,
        string? returnType,
        string signature,
        SyntaxTokenList modifiers)
    {
        if (_typeStack.Count == 0)
        {
            return;
        }

        var lineSpan = _tree.GetLineSpan(node.Span);

        var namespaceName = _namespaceStack.Count > 0 ? string.Join(".", _namespaceStack.Reverse()) : string.Empty;
        var typeFullName = string.Join(".",
            new[] { namespaceName, string.Join(".", _typeStack.Reverse()) }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        var memberId = $"{typeFullName}::{name}::{memberKind}::{lineSpan.StartLinePosition.Line}";

        _payload.Members.Add(new MemberRecord
        {
            Id = memberId,
            TypeFullName = typeFullName,
            MemberName = name,
            MemberKind = memberKind,
            Signature = signature.Trim(),
            ReturnType = returnType,
            FilePath = _filePath,
            StartLine = lineSpan.StartLinePosition.Line,
            EndLine = lineSpan.EndLinePosition.Line,
            Accessibility = GetAccessibility(modifiers.ToString()),
            IsStatic = modifiers.Any(SyntaxKind.StaticKeyword)
        });
    }

    private static string BuildMethodSignature(MethodDeclarationSyntax node)
    {
        return $"{node.Modifiers} {node.ReturnType} {node.Identifier}{node.TypeParameterList}{node.ParameterList}".Trim();
    }

    private static string BuildConstructorSignature(ConstructorDeclarationSyntax node)
    {
        return $"{node.Modifiers} {node.Identifier}{node.ParameterList}".Trim();
    }

    private static string GetAccessibility(string modifiers)
    {
        if (modifiers.Contains("public", StringComparison.Ordinal)) return "public";
        if (modifiers.Contains("protected internal", StringComparison.Ordinal)) return "protected internal";
        if (modifiers.Contains("internal", StringComparison.Ordinal)) return "internal";
        if (modifiers.Contains("protected", StringComparison.Ordinal)) return "protected";
        if (modifiers.Contains("private", StringComparison.Ordinal)) return "private";
        return "unknown";
    }

    private void TryAddSourceLocalization(LiteralExpressionSyntax node)
    {
        if (!node.IsKind(SyntaxKind.StringLiteralExpression))
        {
            return;
        }

        var valueText = node.Token.ValueText;
        if (string.IsNullOrWhiteSpace(valueText))
        {
            return;
        }

        var match = LocalizationTokenRegex.Match(valueText);
        if (!match.Success)
        {
            return;
        }

        var stringId = match.Groups[1].Value.Trim();
        var fallbackText = match.Groups[2].Value.Trim();
        if (string.IsNullOrWhiteSpace(stringId) || stringId == "!")
        {
            return;
        }

        var lineSpan = _tree.GetLineSpan(node.Span);
        var typeFullName = BuildCurrentTypeFullName();
        var memberName = FindContainingMemberName(node);
        var contextKind = InferContextKind(node);

        _payload.SourceLocalizations.Add(new SourceLocalizationRecord
        {
            StringId = stringId,
            FallbackText = fallbackText,
            NormalizedFallback = NormalizeFallbackText(fallbackText),
            FilePath = _filePath,
            ModuleName = _moduleName,
            AssemblyName = _assemblyName,
            TypeFullName = string.IsNullOrWhiteSpace(typeFullName) ? null : typeFullName,
            MemberName = memberName,
            LineNumber = lineSpan.StartLinePosition.Line,
            ColumnNumber = lineSpan.StartLinePosition.Character,
            ContextKind = contextKind,
            SourcePriority = GetSourcePriority(contextKind),
            RawLiteral = node.Token.Text
        });
    }

    private string BuildCurrentTypeFullName()
    {
        var namespaceName = _namespaceStack.Count > 0 ? string.Join(".", _namespaceStack.Reverse()) : string.Empty;
        var typeName = _typeStack.Count > 0 ? string.Join(".", _typeStack.Reverse()) : string.Empty;
        return string.Join(".", new[] { namespaceName, typeName }.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    private static string? FindContainingMemberName(SyntaxNode node)
    {
        var member = node.Ancestors().OfType<MemberDeclarationSyntax>().FirstOrDefault();
        return member switch
        {
            MethodDeclarationSyntax method => method.Identifier.Text,
            ConstructorDeclarationSyntax constructor => constructor.Identifier.Text,
            PropertyDeclarationSyntax property => property.Identifier.Text,
            FieldDeclarationSyntax field => field.Declaration.Variables.FirstOrDefault()?.Identifier.Text,
            EventDeclarationSyntax eventDeclaration => eventDeclaration.Identifier.Text,
            EventFieldDeclarationSyntax eventField => eventField.Declaration.Variables.FirstOrDefault()?.Identifier.Text,
            _ => null
        };
    }

    private static string InferContextKind(LiteralExpressionSyntax node)
    {
        var invocation = node.Ancestors().OfType<InvocationExpressionSyntax>().FirstOrDefault();
        var invocationName = invocation?.Expression switch
        {
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            MemberAccessExpressionSyntax memberAccess => memberAccess.Name.Identifier.Text,
            GenericNameSyntax genericName => genericName.Identifier.Text,
            _ => string.Empty
        };

        if (string.Equals(invocationName, "AddDialogLine", StringComparison.Ordinal) ||
            string.Equals(invocationName, "AddPlayerLine", StringComparison.Ordinal) ||
            string.Equals(invocationName, "NpcLine", StringComparison.Ordinal) ||
            string.Equals(invocationName, "PlayerLine", StringComparison.Ordinal))
        {
            return "dialog_line";
        }

        if (string.Equals(invocationName, "AddGameMenu", StringComparison.Ordinal) ||
            string.Equals(invocationName, "AddWaitGameMenu", StringComparison.Ordinal) ||
            string.Equals(invocationName, "AddGameMenuOption", StringComparison.Ordinal))
        {
            return "menu_text";
        }

        var objectCreation = node.Ancestors().OfType<ObjectCreationExpressionSyntax>().FirstOrDefault();
        if (objectCreation?.Type.ToString().EndsWith("TextObject", StringComparison.Ordinal) == true)
        {
            return "textobject_ctor";
        }

        return "raw_string";
    }

    private static int GetSourcePriority(string contextKind)
    {
        return contextKind switch
        {
            "textobject_ctor" => 0,
            "dialog_line" => 1,
            "menu_text" => 2,
            _ => 3
        };
    }

    private static string NormalizeFallbackText(string text)
    {
        return text.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Trim();
    }

    private static (string ModuleName, string AssemblyName) InferSourceOrigin(string filePath)
    {
        var normalizedPath = filePath.Replace('\\', '/');
        var parts = normalizedPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var modulesIndex = Array.FindIndex(parts, part => string.Equals(part, "Modules", StringComparison.OrdinalIgnoreCase));
        if (modulesIndex >= 0 && modulesIndex + 3 < parts.Length)
        {
            var moduleName = parts[modulesIndex + 1];
            var shippingIndex = Array.FindIndex(parts, modulesIndex, part => string.Equals(part, "Win64_Shipping_Client", StringComparison.OrdinalIgnoreCase));
            var assemblyName = shippingIndex >= 0 && shippingIndex + 1 < parts.Length ? parts[shippingIndex + 1] : moduleName;
            return (moduleName, assemblyName);
        }

        var rootBinIndex = Array.FindIndex(parts, part => string.Equals(part, "Win64_Shipping_Client", StringComparison.OrdinalIgnoreCase));
        if (rootBinIndex >= 0 && rootBinIndex + 1 < parts.Length)
        {
            return ("root-bin", parts[rootBinIndex + 1]);
        }

        return ("unknown", Path.GetFileNameWithoutExtension(filePath));
    }
}

internal static class ProgramHelpers
{
    public static async Task<List<string>> LoadFileListAsync(string sourceDir, string fileListPath)
    {
        var sourceRoot = EnsureTrailingSeparator(Path.GetFullPath(sourceDir));
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rawLine in await File.ReadAllLinesAsync(fileListPath))
        {
            var trimmed = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(trimmed))
            {
                continue;
            }

            var candidate = Path.IsPathRooted(trimmed)
                ? Path.GetFullPath(trimmed)
                : Path.GetFullPath(Path.Combine(sourceDir, trimmed));

            if (!candidate.StartsWith(sourceRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"Indexed file is outside the source directory: {trimmed}");
            }

            if (!File.Exists(candidate))
            {
                throw new FileNotFoundException($"Indexed file does not exist: {trimmed}", candidate);
            }

            if (!candidate.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (seen.Add(candidate))
            {
                result.Add(candidate);
            }
        }

        result.Sort(StringComparer.OrdinalIgnoreCase);
        return result;
    }

    public static string NormalizeRelativePath(string sourceDir, string filePath)
    {
        return Path.GetRelativePath(sourceDir, filePath).Replace('\\', '/');
    }

    private static string EnsureTrailingSeparator(string path)
    {
        return path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
    }
}
