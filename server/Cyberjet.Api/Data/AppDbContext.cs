using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Data;

/// <summary>
/// Contexte EF Core. Le mapping est déclaré explicitement plutôt que laissé aux
/// conventions : le DDL de référence est <c>database/schema.sql</c>, et une
/// convention qui change au fil des versions d'EF ferait dériver l'un de l'autre
/// sans prévenir.
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Client> Clients => Set<Client>();
    public DbSet<Framework> Frameworks => Set<Framework>();
    public DbSet<Control> Controls => Set<Control>();
    public DbSet<KbEntry> KbEntries => Set<KbEntry>();
    public DbSet<KbEntryControl> KbEntryControls => Set<KbEntryControl>();
    public DbSet<ConfigItem> ConfigItems => Set<ConfigItem>();
    public DbSet<Questionnaire> Questionnaires => Set<Questionnaire>();
    public DbSet<QuestionnaireQuestion> QuestionnaireQuestions => Set<QuestionnaireQuestion>();
    public DbSet<AppUser> AppUsers => Set<AppUser>();
    public DbSet<AppSession> AppSessions => Set<AppSession>();
    public DbSet<RecoveryCode> RecoveryCodes => Set<RecoveryCode>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Client>(e =>
        {
            e.ToTable("Clients");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Country).HasMaxLength(120);
            e.Property(x => x.Contact).HasMaxLength(300);
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.UpdatedAt).HasColumnType("datetime2(0)");
        });

        b.Entity<Framework>(e =>
        {
            e.ToTable("Frameworks");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Code).HasMaxLength(40).IsRequired();
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Version).HasMaxLength(200);
            e.Property(x => x.Authority).HasMaxLength(120);
            e.Property(x => x.Accent).HasMaxLength(20).IsRequired();
        });

        b.Entity<Control>(e =>
        {
            e.ToTable("Controls");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.FrameworkId, x.Ref }).IsUnique();
            e.HasIndex(x => x.FrameworkId);
            e.Property(x => x.Ref).HasMaxLength(60).IsRequired();
            e.Property(x => x.Title).HasMaxLength(400).IsRequired();
            e.Property(x => x.Theme).HasMaxLength(120);
            e.HasOne(x => x.Framework).WithMany(f => f.Controls)
             .HasForeignKey(x => x.FrameworkId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<KbEntry>(e =>
        {
            e.ToTable("KbEntries");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.ClientId);
            e.HasIndex(x => x.Status);
            e.Property(x => x.Question).IsRequired();
            e.Property(x => x.Answer).IsRequired();
            e.Property(x => x.Category).HasMaxLength(120).IsRequired();
            e.Property(x => x.Tags).HasMaxLength(500).IsRequired();
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.Evidence).HasMaxLength(500);
            e.Property(x => x.Source).HasMaxLength(300);
            e.Property(x => x.CreatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.UpdatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.ReviewedAt).HasColumnType("datetime2(0)");
            e.HasOne(x => x.Client).WithMany(c => c.KbEntries)
             .HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<KbEntryControl>(e =>
        {
            e.ToTable("KbEntryControls");
            e.HasKey(x => new { x.KbEntryId, x.ControlId });
            e.HasIndex(x => x.ControlId);
            e.HasOne(x => x.KbEntry).WithMany(k => k.Controls)
             .HasForeignKey(x => x.KbEntryId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Control).WithMany(c => c.KbLinks)
             .HasForeignKey(x => x.ControlId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ConfigItem>(e =>
        {
            e.ToTable("ConfigItems");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.ClientId);
            e.Property(x => x.Category).HasMaxLength(120).IsRequired();
            e.Property(x => x.Label).HasMaxLength(300).IsRequired();
            e.Property(x => x.Value).IsRequired();
            e.Property(x => x.Scope).HasMaxLength(500);
            e.Property(x => x.Status).HasMaxLength(30).IsRequired();
            e.Property(x => x.UpdatedAt).HasColumnType("datetime2(0)");
            e.HasOne(x => x.Client).WithMany(c => c.ConfigItems)
             .HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Questionnaire>(e =>
        {
            e.ToTable("Questionnaires");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.ClientId);
            e.Property(x => x.Name).HasMaxLength(300).IsRequired();
            e.Property(x => x.OriginalFilename).HasMaxLength(400);
            e.Property(x => x.StoredPath).HasMaxLength(1000);
            e.Property(x => x.FileType).HasMaxLength(20).IsRequired();
            e.Property(x => x.Status).HasMaxLength(30).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.UpdatedAt).HasColumnType("datetime2(0)");
            e.HasOne(x => x.Client).WithMany(c => c.Questionnaires)
             .HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<QuestionnaireQuestion>(e =>
        {
            e.ToTable("QuestionnaireQuestions");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.QuestionnaireId);
            e.Property(x => x.Ref).HasMaxLength(120);
            e.Property(x => x.Section).HasMaxLength(300);
            e.Property(x => x.Text).IsRequired();
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.MatchedKind).HasMaxLength(20);
            e.HasIndex(x => x.PromotedKbEntryId);
            e.HasOne(x => x.Questionnaire).WithMany(q => q.Questions)
             .HasForeignKey(x => x.QuestionnaireId).OnDelete(DeleteBehavior.Cascade);
            // Aucune contrainte en base — voir database/schema.sql. La navigation
            // reste déclarée pour que la lecture puisse joindre en LEFT JOIN et
            // écarter les liaisons orphelines ; `ClientSetNull` dit à EF de ne
            // rien attendre du serveur sur ce lien.
            e.HasOne(x => x.PromotedKbEntry).WithMany()
             .HasForeignKey(x => x.PromotedKbEntryId).OnDelete(DeleteBehavior.ClientSetNull);
        });

        b.Entity<AppUser>(e =>
        {
            e.ToTable("AppUsers");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Username).IsUnique();
            e.Ignore(x => x.DisplayName);
            e.Property(x => x.Username).HasMaxLength(60).IsRequired();
            e.Property(x => x.PasswordHash).HasMaxLength(200).IsRequired();
            e.Property(x => x.PasswordSalt).HasMaxLength(100).IsRequired();
            e.Property(x => x.TotpSecret).HasMaxLength(100);
            e.Property(x => x.TotpPendingSecret).HasMaxLength(100);
            e.Property(x => x.FirstName).HasMaxLength(80);
            e.Property(x => x.LastName).HasMaxLength(80);
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.JobTitle).HasMaxLength(120);
            e.Property(x => x.Preferences).HasMaxLength(1000);
            e.Property(x => x.CreatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.LastLoginAt).HasColumnType("datetime2(0)");
            e.Property(x => x.MfaEnabledAt).HasColumnType("datetime2(0)");
        });

        b.Entity<AppSession>(e =>
        {
            e.ToTable("AppSessions");
            e.HasKey(x => x.Token);
            e.HasIndex(x => x.UserId);
            e.HasIndex(x => x.ExpiresAt);
            e.HasIndex(x => x.LastSeenAt);
            e.Property(x => x.Token).HasMaxLength(88);
            e.Property(x => x.CreatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.ExpiresAt).HasColumnType("datetime2(0)");
            e.Property(x => x.LastSeenAt).HasColumnType("datetime2(0)");
            e.HasOne(x => x.User).WithMany(u => u.Sessions)
             .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RecoveryCode>(e =>
        {
            e.ToTable("RecoveryCodes");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.UserId);
            e.Property(x => x.CodeHash).HasMaxLength(80).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnType("datetime2(0)");
            e.Property(x => x.UsedAt).HasColumnType("datetime2(0)");
            e.HasOne(x => x.User).WithMany(u => u.RecoveryCodes)
             .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AuditLog>(e =>
        {
            e.ToTable("AuditLogs");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.At).IsDescending();
            e.HasIndex(x => x.Event);
            e.HasIndex(x => x.ActorId);
            e.Property(x => x.At).HasColumnType("datetime2(0)");
            e.Property(x => x.Event).HasMaxLength(60).IsRequired();
            e.Property(x => x.Outcome).HasMaxLength(20).IsRequired();
            e.Property(x => x.ActorName).HasMaxLength(60);
            e.Property(x => x.Ip).HasMaxLength(64);
            e.Property(x => x.UserAgent).HasMaxLength(200);
            e.Property(x => x.TargetType).HasMaxLength(40);
            e.Property(x => x.TargetLabel).HasMaxLength(200);
            e.Property(x => x.Detail).HasMaxLength(500);
        });

        b.Entity<AppSetting>(e =>
        {
            e.ToTable("AppSettings");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(80);
            e.Property(x => x.Value).HasMaxLength(2000).IsRequired();
            e.Property(x => x.UpdatedAt).HasColumnType("datetime2(0)");
        });
    }
}
