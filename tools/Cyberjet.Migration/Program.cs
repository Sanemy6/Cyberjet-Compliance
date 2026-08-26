using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;

/*
 * Reprise des données de la version SQLite vers SQL Server.
 *
 * Utilisation :
 *   dotnet run --project tools/Cyberjet.Migration -- <chemin\grc.db> "<chaîne de connexion>"
 *
 * Trois partis pris, tous destinés à ce que la reprise soit rejouable :
 *
 *   * Les identifiants sont conservés (IDENTITY_INSERT). Les liens entre tables
 *     restent donc valides sans remapping, et un questionnaire rouvert après la
 *     bascule retrouve exactement ses questions.
 *
 *   * Les contrôles normatifs font exception : ils sont réinsérés au démarrage
 *     de l'API et n'ont aucune raison de porter les mêmes identifiants. Les
 *     rattachements sont donc traduits par le couple (code du référentiel,
 *     référence), qui, lui, est stable.
 *
 *   * Les sessions ne sont pas reprises. Un jeton émis par l'ancienne
 *     application n'a pas à ouvrir l'accès à la nouvelle : chacun se reconnecte
 *     une fois. Les mots de passe, eux, fonctionnent tels quels — le format de
 *     hachage est identique (PBKDF2-HMAC-SHA256, 260 000 itérations).
 *
 * La cible doit être vide : le script refuse de s'exécuter sinon, plutôt que de
 * dupliquer des données sur une seconde exécution malencontreuse.
 */

if (args.Length < 2)
{
    Console.Error.WriteLine(
        "Usage : dotnet run --project tools/Cyberjet.Migration -- <grc.db> \"<connexion SQL Server>\"");
    return 1;
}

var sqlitePath = args[0];
var sqlConnectionString = args[1];

if (!File.Exists(sqlitePath))
{
    Console.Error.WriteLine($"Base SQLite introuvable : {sqlitePath}");
    return 1;
}

await using var source = new SqliteConnection(
    new SqliteConnectionStringBuilder { DataSource = sqlitePath, Mode = SqliteOpenMode.ReadOnly }
        .ConnectionString);
await source.OpenAsync();

await using var target = new SqlConnection(sqlConnectionString);
await target.OpenAsync();

var migration = new Migration(source, target);

if (!await migration.TargetIsEmptyAsync())
{
    Console.Error.WriteLine(
        "La base cible contient déjà des données métier. Reprise annulée : videz-la "
        + "d'abord, ou repartez d'une base neuve.");
    return 1;
}

await using var transaction = (SqlTransaction)await target.BeginTransactionAsync();
migration.Transaction = transaction;

try
{
    var controlMap = await migration.BuildControlMapAsync();

    await migration.CopyClientsAsync();
    await migration.CopyKbEntriesAsync();
    await migration.CopyKbControlsAsync(controlMap);
    await migration.CopyConfigItemsAsync();
    await migration.CopyQuestionnairesAsync();
    await migration.CopyQuestionsAsync();
    await migration.CopyUsersAsync();
    await migration.CopyRecoveryCodesAsync();
    await migration.CopyAuditLogsAsync();

    await transaction.CommitAsync();
    Console.WriteLine("\nReprise terminée. Les mots de passe existants restent valides ;");
    Console.WriteLine("chacun devra en revanche se reconnecter une fois.");
    return 0;
}
catch (Exception exception)
{
    await transaction.RollbackAsync();
    Console.Error.WriteLine($"\nÉchec de la reprise : {exception.Message}");
    Console.Error.WriteLine("Aucune donnée n'a été écrite : la transaction a été annulée.");
    return 1;
}

internal sealed class Migration(SqliteConnection source, SqlConnection target)
{
    public SqlTransaction? Transaction { get; set; }

    /// <summary>
    /// Les référentiels et leurs contrôles sont réinsérés par l'API : ils ne
    /// comptent pas comme « données métier ». Tout le reste doit être vide.
    /// </summary>
    public async Task<bool> TargetIsEmptyAsync()
    {
        string[] tables =
        [
            "Clients", "KbEntries", "ConfigItems", "Questionnaires",
            "QuestionnaireQuestions", "AppUsers", "AuditLogs",
        ];

        foreach (var table in tables)
        {
            await using var command = target.CreateCommand();
            command.CommandText = $"SELECT COUNT(*) FROM dbo.{table}";
            var count = Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
            if (count > 0)
            {
                Console.Error.WriteLine($"  {table} contient déjà {count} ligne(s).");
                return false;
            }
        }
        return true;
    }

    /// <summary>
    /// Ancien identifiant de contrôle → nouvel identifiant, via le couple stable
    /// (code du référentiel, référence).
    /// </summary>
    public async Task<Dictionary<long, int>> BuildControlMapAsync()
    {
        var byKey = new Dictionary<(string Code, string Ref), int>();
        await using (var command = target.CreateCommand())
        {
            command.Transaction = Transaction;
            command.CommandText = """
                SELECT f.Code, c.Ref, c.Id
                FROM dbo.Controls c
                JOIN dbo.Frameworks f ON f.Id = c.FrameworkId
                """;
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                byKey[(reader.GetString(0), reader.GetString(1))] = reader.GetInt32(2);
        }

        if (byKey.Count == 0)
            throw new InvalidOperationException(
                "Aucun contrôle en base cible. Lancez l'API une fois pour créer le schéma "
                + "et charger les référentiels, puis relancez la reprise.");

        var map = new Dictionary<long, int>();
        var orphans = 0;

        await using var read = source.CreateCommand();
        read.CommandText = """
            SELECT c.id, f.code, c.ref
            FROM control c JOIN framework f ON f.id = c.framework_id
            """;
        await using var rows = await read.ExecuteReaderAsync();
        while (await rows.ReadAsync())
        {
            var key = (rows.GetString(1), rows.GetString(2));
            if (byKey.TryGetValue(key, out var newId)) map[rows.GetInt64(0)] = newId;
            else orphans++;
        }

        Console.WriteLine($"Contrôles appariés : {map.Count}"
                        + (orphans > 0 ? $" ({orphans} sans équivalent, ignorés)" : ""));
        return map;
    }

    // ----------------------------------------------------------------------
    // Copies table par table
    // ----------------------------------------------------------------------

    public Task CopyClientsAsync() => CopyAsync(
        "client",
        "SELECT id, name, country, contact, description, status, created_at, updated_at FROM client",
        "dbo.Clients",
        "Id, Name, Country, Contact, Description, Status, CreatedAt, UpdatedAt",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", row.GetString(1));
            AddNullableText(command, "@p2", row, 2);
            AddNullableText(command, "@p3", row, 3);
            AddNullableText(command, "@p4", row, 4);
            command.Parameters.AddWithValue("@p5", row.GetString(5));
            command.Parameters.AddWithValue("@p6", ParseDate(row.GetString(6)));
            command.Parameters.AddWithValue("@p7", ParseDate(row.GetString(7)));
        });

    public Task CopyKbEntriesAsync() => CopyAsync(
        "kb_entry",
        """
        SELECT id, client_id, question, answer, category, tags, status, evidence, source,
               usage_count, created_at, updated_at, reviewed_at
        FROM kb_entry
        """,
        "dbo.KbEntries",
        "Id, ClientId, Question, Answer, Category, Tags, Status, Evidence, Source, "
        + "UsageCount, CreatedAt, UpdatedAt, ReviewedAt",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            AddNullableLong(command, "@p1", row, 1);
            command.Parameters.AddWithValue("@p2", row.GetString(2));
            command.Parameters.AddWithValue("@p3", row.GetString(3));
            command.Parameters.AddWithValue("@p4", row.GetString(4));
            command.Parameters.AddWithValue("@p5", row.GetString(5));
            command.Parameters.AddWithValue("@p6", row.GetString(6));
            AddNullableText(command, "@p7", row, 7);
            AddNullableText(command, "@p8", row, 8);
            command.Parameters.AddWithValue("@p9", row.GetInt64(9));
            command.Parameters.AddWithValue("@p10", ParseDate(row.GetString(10)));
            command.Parameters.AddWithValue("@p11", ParseDate(row.GetString(11)));
            AddNullableDate(command, "@p12", row, 12);
        });

    public async Task CopyKbControlsAsync(Dictionary<long, int> controlMap)
    {
        var inserted = 0;
        var skipped = 0;

        await using var read = source.CreateCommand();
        read.CommandText = "SELECT kb_entry_id, control_id FROM kb_control";
        await using var rows = await read.ExecuteReaderAsync();

        while (await rows.ReadAsync())
        {
            if (!controlMap.TryGetValue(rows.GetInt64(1), out var controlId)) { skipped++; continue; }

            await using var insert = target.CreateCommand();
            insert.Transaction = Transaction;
            insert.CommandText =
                "INSERT INTO dbo.KbEntryControls (KbEntryId, ControlId) VALUES (@e, @c)";
            insert.Parameters.AddWithValue("@e", rows.GetInt64(0));
            insert.Parameters.AddWithValue("@c", controlId);
            await insert.ExecuteNonQueryAsync();
            inserted++;
        }

        Console.WriteLine($"kb_control → KbEntryControls : {inserted}"
                        + (skipped > 0 ? $" ({skipped} rattachement(s) orphelin(s) ignoré(s))" : ""));
    }

    public Task CopyConfigItemsAsync() => CopyAsync(
        "config_item",
        "SELECT id, client_id, category, label, value, details, scope, status, updated_at FROM config_item",
        "dbo.ConfigItems",
        "Id, ClientId, Category, Label, Value, Details, Scope, Status, UpdatedAt",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", row.GetInt64(1));
            command.Parameters.AddWithValue("@p2", row.GetString(2));
            command.Parameters.AddWithValue("@p3", row.GetString(3));
            command.Parameters.AddWithValue("@p4", row.GetString(4));
            AddNullableText(command, "@p5", row, 5);
            AddNullableText(command, "@p6", row, 6);
            command.Parameters.AddWithValue("@p7", row.GetString(7));
            command.Parameters.AddWithValue("@p8", ParseDate(row.GetString(8)));
        });

    public Task CopyQuestionnairesAsync() => CopyAsync(
        "questionnaire",
        """
        SELECT id, client_id, name, original_filename, stored_path, file_type, status,
               notes, created_at, updated_at
        FROM questionnaire
        """,
        "dbo.Questionnaires",
        "Id, ClientId, Name, OriginalFilename, StoredPath, FileType, Status, Notes, "
        + "CreatedAt, UpdatedAt",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", row.GetInt64(1));
            command.Parameters.AddWithValue("@p2", row.GetString(2));
            AddNullableText(command, "@p3", row, 3);
            AddNullableText(command, "@p4", row, 4);
            command.Parameters.AddWithValue("@p5", row.GetString(5));
            command.Parameters.AddWithValue("@p6", row.GetString(6));
            AddNullableText(command, "@p7", row, 7);
            command.Parameters.AddWithValue("@p8", ParseDate(row.GetString(8)));
            command.Parameters.AddWithValue("@p9", ParseDate(row.GetString(9)));
        });

    /// <summary>
    /// Les candidats mis en cache ne sont pas repris : leur sérialisation a
    /// changé de casse entre les deux versions. Ils se reconstruisent au premier
    /// « Relancer », et une liste vide vaut mieux qu'une liste illisible.
    /// </summary>
    public Task CopyQuestionsAsync() => CopyAsync(
        "qq_question",
        """
        SELECT id, questionnaire_id, idx, ref, section, text, suggested_answer,
               final_answer, status, confidence, matched_kind, matched_id,
               locator_json, promoted_kb_id
        FROM qq_question
        """,
        "dbo.QuestionnaireQuestions",
        "Id, QuestionnaireId, Idx, Ref, Section, Text, SuggestedAnswer, FinalAnswer, "
        + "Status, Confidence, MatchedKind, MatchedId, LocatorJson, PromotedKbEntryId",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", row.GetInt64(1));
            command.Parameters.AddWithValue("@p2", row.GetInt64(2));
            AddNullableText(command, "@p3", row, 3);
            AddNullableText(command, "@p4", row, 4);
            command.Parameters.AddWithValue("@p5", row.GetString(5));
            AddNullableText(command, "@p6", row, 6);
            AddNullableText(command, "@p7", row, 7);
            command.Parameters.AddWithValue("@p8", row.GetString(8));
            command.Parameters.AddWithValue("@p9", row.IsDBNull(9) ? 0d : row.GetDouble(9));
            AddNullableText(command, "@p10", row, 10);
            AddNullableLong(command, "@p11", row, 11);
            AddNullableText(command, "@p12", row, 12);
            AddNullableLong(command, "@p13", row, 13);
        });

    public Task CopyUsersAsync() => CopyAsync(
        "app_user",
        """
        SELECT id, username, password_hash, password_salt, is_admin, active, created_at,
               last_login_at, totp_secret, totp_pending_secret, totp_enabled,
               totp_last_counter, mfa_enabled_at, first_name, last_name, email, phone,
               job_title, preferences
        FROM app_user
        """,
        "dbo.AppUsers",
        "Id, Username, PasswordHash, PasswordSalt, IsAdmin, Active, CreatedAt, LastLoginAt, "
        + "TotpSecret, TotpPendingSecret, TotpEnabled, TotpLastCounter, MfaEnabledAt, "
        + "FirstName, LastName, Email, Phone, JobTitle, Preferences",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", row.GetString(1));
            command.Parameters.AddWithValue("@p2", row.GetString(2));
            command.Parameters.AddWithValue("@p3", row.GetString(3));
            command.Parameters.AddWithValue("@p4", row.GetInt64(4) != 0);
            command.Parameters.AddWithValue("@p5", row.GetInt64(5) != 0);
            command.Parameters.AddWithValue("@p6", ParseDate(row.GetString(6)));
            AddNullableDate(command, "@p7", row, 7);
            AddNullableText(command, "@p8", row, 8);
            AddNullableText(command, "@p9", row, 9);
            command.Parameters.AddWithValue("@p10", !row.IsDBNull(10) && row.GetInt64(10) != 0);
            AddNullableLong(command, "@p11", row, 11);
            AddNullableDate(command, "@p12", row, 12);
            AddNullableText(command, "@p13", row, 13);
            AddNullableText(command, "@p14", row, 14);
            AddNullableText(command, "@p15", row, 15);
            AddNullableText(command, "@p16", row, 16);
            AddNullableText(command, "@p17", row, 17);
            AddNullableText(command, "@p18", row, 18);
        });

    public Task CopyRecoveryCodesAsync() => CopyAsync(
        "app_recovery_code",
        "SELECT id, user_id, code_hash, created_at, used_at FROM app_recovery_code",
        "dbo.RecoveryCodes",
        "Id, UserId, CodeHash, CreatedAt, UsedAt",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", row.GetInt64(1));
            command.Parameters.AddWithValue("@p2", row.GetString(2));
            command.Parameters.AddWithValue("@p3", ParseDate(row.GetString(3)));
            AddNullableDate(command, "@p4", row, 4);
        });

    public Task CopyAuditLogsAsync() => CopyAsync(
        "audit_log",
        """
        SELECT id, at, event, outcome, actor_id, actor_name, ip, user_agent,
               target_type, target_id, target_label, detail
        FROM audit_log ORDER BY id
        """,
        "dbo.AuditLogs",
        "Id, At, Event, Outcome, ActorId, ActorName, Ip, UserAgent, TargetType, "
        + "TargetId, TargetLabel, Detail",
        identityInsert: true,
        (row, command) =>
        {
            command.Parameters.AddWithValue("@p0", row.GetInt64(0));
            command.Parameters.AddWithValue("@p1", ParseDate(row.GetString(1)));
            command.Parameters.AddWithValue("@p2", row.GetString(2));
            command.Parameters.AddWithValue("@p3", row.GetString(3));
            AddNullableLong(command, "@p4", row, 4);
            AddNullableText(command, "@p5", row, 5);
            AddNullableText(command, "@p6", row, 6);
            AddNullableText(command, "@p7", row, 7);
            AddNullableText(command, "@p8", row, 8);
            AddNullableLong(command, "@p9", row, 9);
            AddNullableText(command, "@p10", row, 10);
            AddNullableText(command, "@p11", row, 11);
        });

    // ----------------------------------------------------------------------
    // Mécanique commune
    // ----------------------------------------------------------------------

    private async Task CopyAsync(
        string sourceLabel, string selectSql, string targetTable, string columns,
        bool identityInsert, Action<SqliteDataReader, SqlCommand> bind)
    {
        var placeholders = string.Join(", ",
            Enumerable.Range(0, columns.Split(',').Length).Select(i => $"@p{i}"));

        if (identityInsert) await ExecuteAsync($"SET IDENTITY_INSERT {targetTable} ON");

        var inserted = 0;
        await using (var read = source.CreateCommand())
        {
            read.CommandText = selectSql;
            await using var rows = await read.ExecuteReaderAsync();

            while (await rows.ReadAsync())
            {
                await using var insert = target.CreateCommand();
                insert.Transaction = Transaction;
                insert.CommandText =
                    $"INSERT INTO {targetTable} ({columns}) VALUES ({placeholders})";
                bind(rows, insert);
                await insert.ExecuteNonQueryAsync();
                inserted++;
            }
        }

        if (identityInsert) await ExecuteAsync($"SET IDENTITY_INSERT {targetTable} OFF");

        Console.WriteLine($"{sourceLabel} → {targetTable} : {inserted}");
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var command = target.CreateCommand();
        command.Transaction = Transaction;
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Les horodatages étaient stockés en texte ISO 8601, généralement suffixés
    /// « +00:00 ». On les ramène en UTC sans décalage : la colonne cible est un
    /// <c>datetime2</c>, qui ne porte pas de fuseau.
    /// </summary>
    private static DateTime ParseDate(string value)
    {
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
                                    DateTimeStyles.AssumeUniversal, out var offset))
            return offset.UtcDateTime;

        if (DateTime.TryParse(value, CultureInfo.InvariantCulture,
                              DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                              out var parsed))
            return parsed;

        throw new FormatException($"Horodatage illisible : « {value} ».");
    }

    private static void AddNullableText(SqlCommand command, string name, SqliteDataReader row, int index) =>
        command.Parameters.AddWithValue(name, row.IsDBNull(index) ? DBNull.Value : row.GetString(index));

    private static void AddNullableLong(SqlCommand command, string name, SqliteDataReader row, int index) =>
        command.Parameters.AddWithValue(name, row.IsDBNull(index) ? DBNull.Value : row.GetInt64(index));

    private static void AddNullableDate(SqlCommand command, string name, SqliteDataReader row, int index) =>
        command.Parameters.AddWithValue(
            name, row.IsDBNull(index) ? DBNull.Value : ParseDate(row.GetString(index)));
}
