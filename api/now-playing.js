// GET /api/now-playing -> what I'm listening to on Spotify right now (or the last track played).
// Runs as a Vercel serverless function, so the Spotify secrets never reach the browser.
// NOT USED right now: the MP3 player plays local lofi instead. Kept for a future live "now playing" view.
//
// One-time setup:
// 1. developer.spotify.com/dashboard -> Create app. Redirect URI: http://127.0.0.1:8888/callback
//    Copy the Client ID and Client Secret.
// 2. Open this in a browser (put your Client ID in), approve, then copy the `code=` value from the
//    URL it redirects to (the page itself will fail to load, that's fine):
//    https://accounts.spotify.com/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback&scope=user-read-currently-playing%20user-read-recently-played
// 3. Swap the code for a refresh token:
//    curl -X POST https://accounts.spotify.com/api/token -u CLIENT_ID:CLIENT_SECRET \
//      -d grant_type=authorization_code -d code=CODE -d redirect_uri=http://127.0.0.1:8888/callback
//    Copy "refresh_token" from the response.
// 4. Vercel -> Project -> Settings -> Environment Variables:
//    SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN. Redeploy.

export default async function handler(req, res) {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refresh } = process.env
  if (!id || !secret || !refresh) return res.status(503).json({ error: 'Spotify not configured' })

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    })
    const { access_token } = await tokenRes.json()
    const auth = { headers: { Authorization: `Bearer ${access_token}` } }

    let item
    let playing = false
    let progressMs = 0
    const now = await fetch('https://api.spotify.com/v1/me/player/currently-playing', auth)
    if (now.status === 200) {
      const d = await now.json()
      if (d.item) ({ item, is_playing: playing, progress_ms: progressMs } = d)
    }
    if (!item) {
      const recent = await (await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', auth)).json()
      item = recent.items?.[0]?.track
    }
    if (!item) return res.status(204).end()

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    res.json({
      playing,
      title: item.name,
      artist: item.artists.map((a) => a.name).join(', '),
      albumArt: item.album.images.at(-2)?.url ?? item.album.images[0]?.url, // ~300px
      url: item.external_urls.spotify,
      progressMs,
      durationMs: item.duration_ms,
    })
  } catch {
    res.status(502).json({ error: 'Spotify request failed' })
  }
}
