// Types de la base. À régénérer une fois le projet Supabase créé :
//   npx supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts
// En attendant, la base n'est pas typée (les règles de sécurité, elles,
// sont dans la base et testées par scripts/tester-base.sh).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
