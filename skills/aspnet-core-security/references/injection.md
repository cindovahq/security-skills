# ASP.NET Core — Injection, Deserialization and XML

## Contents
- EF Core raw SQL
- Dapper and ADO.NET
- Dynamic LINQ and expression building
- OS commands
- LDAP and other interpreters
- Deserialization
- XML and XXE
- Severity, false positives, verification

## EF Core raw SQL

| API | Safe with user values? |
|---|---|
| LINQ (`Where`, `OrderBy` with lambdas) | Yes, values are parameters |
| `FromSql($"... {v}")` (EF Core 7+), `FromSqlInterpolated($"... {v}")` | Yes: takes `FormattableString`, each hole becomes a `DbParameter` |
| `Database.ExecuteSql($"...")` (7+), `ExecuteSqlInterpolated`, `Database.SqlQuery<T>($"...")` (7+ scalars, 8+ unmapped types) | Yes, same mechanism |
| `FromSqlRaw("... {0}", v)` / `ExecuteSqlRaw("... @p", new SqlParameter("p", v))` | Yes, when the SQL text is constant and values go in the parameter array |
| `FromSqlRaw($"... {v}")`, `FromSqlRaw("..." + v)`, `ExecuteSqlRaw($"...")`, `SqlQueryRaw<T>($"...")` | **No**: the string is built before EF sees it |

The EF Core docs state `FromSql` and `FromSqlInterpolated` are safe against SQL injection and `FromSqlRaw` can be vulnerable if improperly used. The EF analyzers report `EF1002` (EF Core 8+) for interpolated strings and `EF1003` (EF Core 10) for concatenation or `string.Format` passed to raw methods. Watch for indirection: an interpolated string assigned to a `string` variable first, then passed to `FromSqlRaw` (no warning, still injectable). Identifiers (column, table, sort direction) can't be parameters; they need an allow-list even with `FromSql`.

## Dapper and ADO.NET

```csharp
await conn.QueryAsync<Order>($"SELECT * FROM Orders WHERE Status = '{status}'");     // injectable: Dapper receives a plain string
await conn.QueryAsync<Order>("SELECT * FROM Orders WHERE Status = @status", new { status });   // safe
var cmd = new SqlCommand("SELECT ... WHERE Name = '" + name + "'", conn);                       // injectable
cmd.Parameters.Add(new SqlParameter("@name", SqlDbType.NVarChar, 100) { Value = name });        // safe
```
Dapper `IN @ids` with a list parameter is safe. `string.Format`, `StringBuilder.Append(userValue)` into SQL, dynamic `ORDER BY {sort}` and stored procedures that build dynamic SQL internally (`EXEC(@sql)`, `sp_executesql` with concatenation) are findings. Unpatched `Microsoft.Data.SqlClient` (fixed in 2.1.7, 3.1.5, 4.0.5, 5.1.3) and `System.Data.SqlClient` < 4.8.6 have CVE-2024-0056 (TLS bypass); see `dependencies.md`.

## Dynamic LINQ and expression building

`System.Linq.Dynamic.Core` parses strings into expressions: `query.Where(filterString)`, `OrderBy(sortString)`, `Select(...)`.
- Versions `>= 1.0.7.10, < 1.3.0`: **CVE-2023-32571**, arbitrary code execution when untrusted input reaches these methods. Fixed in 1.3.0.
- Versions `< 1.6.0`: **CVE-2024-51417**, property reflection that exposes data beyond the intended members. Fixed in 1.6.0.
- On current versions, user-supplied property paths still allow sorting or filtering by sensitive columns (`PasswordHash`, `ApiKey`), which is an ordering/filter oracle. Allow-list sortable and filterable fields.

Also review hand-built expression trees (`Expression.Property(param, userField)`), OData endpoints (`[EnableQuery]` without `AllowedQueryOptions`/`$select` limits, `$expand` into navigation properties of other tenants), and GraphQL resolvers.

## OS commands

`Process.Start(string fileName, string arguments)` passes `arguments` as one string that the target program splits; with `UseShellExecute = false` (the .NET Core default) no shell is involved, but invoking `/bin/sh -c`, `bash -c`, `cmd.exe /c` or `powershell -Command` with interpolated input is command injection. Safer: `ProcessStartInfo.ArgumentList.Add(...)` per argument, a fixed executable path, and allow-listed values. Argument injection still applies (`--output=/etc/...` or a value starting with `-`), so validate values even with `ArgumentList`.

## LDAP and other interpreters

- LDAP: `DirectorySearcher.Filter = $"(sAMAccountName={user})"` or `System.DirectoryServices.Protocols.SearchRequest` filters built by concatenation. Escape per RFC 4515 (`*`, `(`, `)`, `\`, NUL) or validate strictly.
- XPath: `XPathNavigator.Select($"//user[name='{n}']")`. Use `XsltArgumentList`/variables or validation.
- Razor runtime compilation or `RazorLight`/`Scriban`/`DotLiquid` templates built from user input: template injection. Roslyn scripting (`CSharpScript.EvaluateAsync(userCode)`): code execution.
- Log injection: user strings in structured logging are fine (`_logger.LogInformation("User {Name}", name)`); string-concatenated messages with newlines can forge entries in plain-text sinks.

## Deserialization

| Serializer | Risk |
|---|---|
| `System.Text.Json` | Safe by default: no type metadata; polymorphism only for types declared with `[JsonDerivedType]` |
| `Newtonsoft.Json` with `TypeNameHandling` `Objects`, `Arrays`, `All` or `Auto` | Unsafe on untrusted input: the payload chooses the .NET type (CWE-502). Newtonsoft's docs say to validate incoming types with a custom `ISerializationBinder`. `TypeNameHandling.None` (default) is safe |
| `BinaryFormatter`, `SoapFormatter`, `NetDataContractSerializer`, `LosFormatter`, `ObjectStateFormatter` | Unsafe. On .NET 8 `BinaryFormatter` methods throw `NotSupportedException` unless `<EnableUnsafeBinaryFormatterSerialization>true` is set; on .NET 9+ the runtime implementation always throws `PlatformNotSupportedException` unless the unsupported `System.Runtime.Serialization.Formatters` package is referenced. Finding either opt-in is a red flag |
| `DataContractSerializer`, `XmlSerializer` | Constrained to the declared type graph and known types. Unsafe when the type is taken from input (`new XmlSerializer(Type.GetType(userValue))`) or known types are overly broad (`object` members with permissive resolvers) |
| `MessagePack-CSharp` with `TypelessContractlessStandardResolver` / typeless mode | Unsafe on untrusted input; use standard resolvers and `MessagePackSecurity.UntrustedData` |
| YAML (`YamlDotNet`) with type tags mapped to arbitrary types | Review tag mappings |

Look for: `JsonSerializerSettings { TypeNameHandling = ... }` set globally in `AddNewtonsoftJson(o => o.SerializerSettings.TypeNameHandling = ...)`, in Hangfire/SignalR/caching serializers fed from clients, `Type.GetType(request...)`, `Activator.CreateInstance(userType)`, and data from cookies, hidden fields or message queues that clients can write.

## XML and XXE

Modern .NET is safe by default: `XmlReaderSettings.DtdProcessing` defaults to `Prohibit` and `XmlResolver` to `null`; `XmlDocument` has no resolver unless one is assigned; `XDocument.Load` parses DTDs but has no resolver and caps entity expansion at 10,000,000 characters. XXE requires an explicit opt-in such as:
```csharp
var doc = new XmlDocument { XmlResolver = new XmlUrlResolver() };                    // external entities resolved
var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Parse, XmlResolver = new XmlUrlResolver() };
```
Also report `MaxCharactersFromEntities = 0` with `DtdProcessing.Parse` on untrusted input (entity expansion DoS), and user-supplied XSLT stylesheets loaded with `XsltSettings.TrustedXslt` or `EnableDocumentFunction = true` plus a resolver (file read and SSRF through `document()`). XSLT script blocks are not supported on .NET Core/.NET 5+.

## Severity, false positives, verification

Severity: unauthenticated SQL injection or deserialization RCE **Critical**; authenticated SQL injection **High/Critical** (data scope decides); dynamic LINQ RCE (< 1.3.0) **Critical**; command injection **Critical** (High if admin-only); XXE with file read or SSRF **High**; LDAP injection that bypasses authentication **High**.

False positives: `FromSql`/`ExecuteSql`/`SqlQuery` with interpolation; `FromSqlRaw` with constant text and parameters; Dapper with parameter objects; `Process.Start` with constant arguments; `XDocument.Load`/`XmlReader.Create` defaults; `Newtonsoft.Json` with default settings; `BinaryFormatter` present only in unreachable or test code (report the package opt-in as Hardening).

Verify: an integration test sending a quote-containing benign value (`O'Brien`) succeeds and returns only the expected rows; EF query logging in the test (`LogTo`) shows `@p0`-style parameters; a test that a sort parameter outside the allow-list returns 400; a unit test that the JSON settings used for request bodies have `TypeNameHandling.None`. Run `dotnet list package --vulnerable --include-transitive` for library advisories.

References: https://learn.microsoft.com/ef/core/querying/sql-queries, https://github.com/advisories/GHSA-w65q-jcmv-28gj (CVE-2023-32571), https://github.com/advisories/GHSA-4cv2-4hjh-77rx (CVE-2024-51417), https://learn.microsoft.com/dotnet/standard/serialization/binaryformatter-migration-guide/, https://learn.microsoft.com/dotnet/standard/data/xml/resolving-external-resources; OWASP Deserialization, XXE Prevention and SQL Injection Prevention cheat sheets; CWE-89, CWE-78, CWE-90, CWE-502, CWE-611.
