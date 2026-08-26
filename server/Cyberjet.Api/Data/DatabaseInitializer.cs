using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Data;

/// <summary>
/// Panne de configuration détectée au démarrage, dont le message est destiné à
/// la personne qui installe l'application. <see cref="Program"/> l'affiche seul,
/// sans pile d'appels : celle-ci n'apprendrait rien à qui doit corriger une
/// chaîne de connexion.
/// </summary>
public sealed class StartupException(string message, Exception inner)
    : Exception(message, inner);

/// <summary>
/// Met la base en état au démarrage : création si elle n'existe pas, puis
/// application du DDL idempotent de <c>database/schema.sql</c>.
///
/// Le choix d'un script SQL plutôt que de migrations EF est délibéré. Ici le
/// schéma est petit et stable, il doit rester relisible par un DBA, et
/// l'application doit pouvoir s'installer seule sur une base vide — sans exiger
/// qu'on ait d'abord lancé <c>dotnet ef database update</c> sur le serveur.
/// Adopter les migrations plus tard reste possible : il suffira de générer une
/// migration initiale et de la marquer comme déjà appliquée.
/// </summary>
public static partial class DatabaseInitializer
{
    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex BatchSeparator();

    public static async Task InitializeAsync(IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
                       .CreateLogger(nameof(DatabaseInitializer));

        try
        {
            await EnsureDatabaseExistsAsync(db, log, ct);
            await ApplySchemaAsync(db, log, ct);
        }
        catch (SqlException exception) when (exception.Number is -1 or 2 or 53 or 4060 or 18456)
        {
            // Serveur injoignable, instance inconnue ou connexion refusée. C'est
            // l'erreur du premier démarrage, celle que rencontre quelqu'un qui
            // installe l'application — elle mérite une phrase, pas vingt lignes
            // de pile qui n'apprennent rien à qui doit agir.
            throw new StartupException(BuildConnectionAdvice(db, exception), exception);
        }
    }

    private static string BuildConnectionAdvice(AppDbContext db, SqlException exception)
    {
        var builder = new SqlConnectionStringBuilder(db.Database.GetConnectionString());
        var server = string.IsNullOrWhiteSpace(builder.DataSource) ? "(non renseigné)" : builder.DataSource;

        var cause = exception.Number switch
        {
            4060 => "La base existe mais le compte n'a pas le droit de s'y connecter.",
            18456 => "Le serveur a refusé les identifiants fournis.",
            _ => "Aucun serveur SQL ne répond à cette adresse.",
        };

        return $"""
            Connexion à SQL Server impossible.

              Serveur visé : {server}
              Cause        : {cause}

            Que faire :
              1. Vérifiez qu'une instance SQL Server tourne  —  Get-Service MSSQL*
              2. Si vous venez d'installer SQL Server Express, l'instance s'appelle
                 « .\SQLEXPRESS » et non « (localdb)\MSSQLLocalDB ». Corrigez
                 ConnectionStrings:Default dans appsettings.json, ou posez la variable
                 d'environnement ConnectionStrings__Default.
              3. Sur un serveur distant, vérifiez que les connexions TCP/IP sont
                 activées et que le pare-feu laisse passer le port 1433.
            """;
    }

    /// <summary>
    /// Crée la base si le serveur ne la connaît pas encore. On se connecte à
    /// <c>master</c> pour cela : une chaîne de connexion pointant vers une base
    /// absente échoue avant même de pouvoir la créer.
    /// </summary>
    private static async Task EnsureDatabaseExistsAsync(
        AppDbContext db, ILogger log, CancellationToken ct)
    {
        var builder = new SqlConnectionStringBuilder(db.Database.GetConnectionString());
        var databaseName = builder.InitialCatalog;
        if (string.IsNullOrWhiteSpace(databaseName)) return;

        builder.InitialCatalog = "master";
        await using var connection = new SqlConnection(builder.ConnectionString);
        await connection.OpenAsync(ct);

        await using var command = connection.CreateCommand();
        // Le nom de base ne peut pas être un paramètre dans un CREATE DATABASE :
        // il est encadré par QUOTENAME côté serveur, ce qui neutralise toute
        // injection par un nom de catalogue exotique.
        command.CommandText = """
            IF DB_ID(@name) IS NULL
            BEGIN
                DECLARE @sql NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@name);
                EXEC sp_executesql @sql;
            END
            """;
        command.Parameters.AddWithValue("@name", databaseName);
        await command.ExecuteNonQueryAsync(ct);

        log.LogInformation("Base « {Database} » disponible.", databaseName);
    }

    private static async Task ApplySchemaAsync(AppDbContext db, ILogger log, CancellationToken ct)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Data", "schema.sql");
        if (!File.Exists(path))
        {
            // Repli sur le dépôt : utile en développement quand l'application est
            // lancée depuis les sources sans copie des ressources.
            var fromRepo = Path.Combine(AppContext.BaseDirectory,
                "..", "..", "..", "..", "..", "database", "schema.sql");
            path = Path.GetFullPath(fromRepo);
        }
        if (!File.Exists(path))
            throw new FileNotFoundException(
                "Le script de schéma est introuvable. Attendu dans database/schema.sql.", path);

        var script = await File.ReadAllTextAsync(path, ct);
        var batches = BatchSeparator().Split(script)
            .Select(batch => batch.Trim())
            .Where(batch => batch.Length > 0);

        foreach (var batch in batches)
            await db.Database.ExecuteSqlRawAsync(batch, ct);

        log.LogInformation("Schéma appliqué depuis {Path}.", path);
    }
}
