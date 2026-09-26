/* ============================================================
   CONFIGURATION – seul fichier que tu dois modifier
   ============================================================ */
window.CONFIG = {
  // Nom affiché sur l'écran de connexion
  FAMILY_NAME: 'Maison Martin',

  // Supabase > Project Settings > API
  SUPABASE_URL: 'COLLE_ICI_TON_PROJECT_URL',
  SUPABASE_ANON_KEY: 'COLLE_ICI_TA_CLE_ANON',

  // Adresse de ton Worker Cloudflare (relais vidéo). Laisse vide au début :
  // les appels marcheront en Wi-Fi ; remplis-la pour la 4G.
  TURN_URL: '',

  // Limite d'une vidéo envoyée depuis la galerie (limite gratuite Supabase : 50 Mo)
  MAX_VIDEO_MB: 50,

  // Palette des couleurs de membres (l'admin peut les changer)
  PALETTE: ['#00E5FF', '#FF3D9A', '#B8FF3D', '#8B5CF6', '#FF9F1C', '#FFE14D', '#3D8BFF', '#2EE6A6']
};
