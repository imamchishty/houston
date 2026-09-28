
// One person, many names. Jira shows display names, GitHub shows logins.
// PEOPLE="Aisha Khan=akhan|aisha.khan;Karim Haddad=karimh" maps every alias to one canonical name.
const aliases = new Map<string, string>();
for (const entry of (process.env.PEOPLE ?? '').split(';').filter(Boolean)) {
  const [canonical, list] = entry.split('=');
  const c = canonical.trim();
  aliases.set(c.toLowerCase(), c);
  for (const a of (list ?? '').split('|')) if (a.trim()) aliases.set(a.trim().toLowerCase(), c);
}

export const canonical = (name: string | null | undefined): string | null =>
  name ? aliases.get(name.toLowerCase()) ?? name : null;

