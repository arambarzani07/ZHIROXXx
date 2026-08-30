using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using Microsoft.Win32;

namespace ZhiroxPOS.Data
{
    public sealed class GoldenConnectionOptions
    {
        public string ConnectionString { get; }

        public GoldenConnectionOptions(string connectionString)
        {
            ConnectionString = connectionString;
        }

        public static GoldenConnectionOptions FromConfig()
        {
            var entry = ConfigurationManager.ConnectionStrings["GoldenDatabase"];
            var configured = entry?.ConnectionString ?? string.Empty;
            return new GoldenConnectionOptions(
                ResolveAvailableLocalConnectionString(configured));
        }

        // V11.1 field hardening: if the configured local SQL instance name is
        // wrong (for example .\\SQLEXPRESS does not exist), probe only local
        // SQL Server candidates for the SAME target database and credentials.
        // This does not create, restore, migrate or modify any database.
        public static string ResolveAvailableLocalConnectionString(
            string configuredConnectionString)
        {
            if (string.IsNullOrWhiteSpace(configuredConnectionString))
                return configuredConnectionString ?? string.Empty;

            SqlConnectionStringBuilder configured;
            try
            {
                configured = new SqlConnectionStringBuilder(configuredConnectionString);
            }
            catch
            {
                return configuredConnectionString;
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var dataSource in CandidateDataSources(configured.DataSource))
            {
                if (string.IsNullOrWhiteSpace(dataSource) || !seen.Add(dataSource))
                    continue;

                var candidate = new SqlConnectionStringBuilder(configured.ConnectionString)
                {
                    DataSource = dataSource,
                    ConnectTimeout = 2
                };

                if (CanOpen(candidate.ConnectionString))
                    return candidate.ConnectionString;
            }

            // Preserve the configured value so callers still receive the real
            // SQL exception when no local instance contains the target DB.
            return configuredConnectionString;
        }

        private static IEnumerable<string> CandidateDataSources(string configured)
        {
            if (!string.IsNullOrWhiteSpace(configured))
                yield return configured;

            yield return ".";
            yield return @".\SQLEXPRESS";

            foreach (var value in RegistryCandidates(RegistryView.Registry64))
                yield return value;

            foreach (var value in RegistryCandidates(RegistryView.Registry32))
                yield return value;

            // Useful on development/test PCs; selected only if the exact
            // configured Golden database is actually present there.
            yield return @"(localdb)\MSSQLLocalDB";
        }

        private static IEnumerable<string> RegistryCandidates(RegistryView view)
        {
            var results = new List<string>();
            try
            {
                using (var hive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                using (var key = hive.OpenSubKey(
                    @"SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"))
                {
                    if (key == null)
                        return results;

                    foreach (var name in key.GetValueNames())
                    {
                        if (string.Equals(name, "MSSQLSERVER", StringComparison.OrdinalIgnoreCase))
                            results.Add(".");
                        else if (!string.IsNullOrWhiteSpace(name))
                            results.Add(@".\" + name);
                    }
                }
            }
            catch
            {
                // Registry probing is best-effort only.
            }

            return results;
        }

        private static bool CanOpen(string connectionString)
        {
            try
            {
                using (var cn = new SqlConnection(connectionString))
                {
                    cn.Open();
                    using (var cmd = cn.CreateCommand())
                    {
                        cmd.CommandText = "SELECT 1";
                        cmd.CommandTimeout = 2;
                        return Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
