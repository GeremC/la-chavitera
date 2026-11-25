// Synchro du foyer (Supabase). Laisser vide = tout reste en local sur chaque téléphone.
// La clé "anon" est publique par conception : les données ne sont lisibles qu'avec le code du foyer.
window.LC_CONFIG = {
  SUPABASE_URL: '',       // ex : 'https://abcdxyz.supabase.co'
  SUPABASE_ANON_KEY: '',  // clé publishable (sb_publishable_...) ou ancienne clé anon
};
