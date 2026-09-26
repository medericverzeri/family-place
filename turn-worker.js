/**
 * Worker Cloudflare — distribue des identifiants TURN temporaires (1 h).
 * La clé secrète (TURN_KEY_API_TOKEN) reste ici, jamais dans l'app.
 *
 * Installation : voir GUIDE.md, étape "Visio fiable en 4G (optionnel)".
 */
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      const r = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ttl: 3600 })
        }
      );
      if (!r.ok) throw new Error('cloudflare ' + r.status);
      const data = await r.json();
      return new Response(JSON.stringify(data), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    } catch (e) {
      // En cas de souci, on retombe sur STUN seul : l'appel marche en Wi-Fi, pas garanti en 4G.
      return new Response(JSON.stringify({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }
  }
};
