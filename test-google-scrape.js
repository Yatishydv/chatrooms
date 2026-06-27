async function test() {
  const q = 'cats';
  const res = await fetch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&tbm=isch&safe=off&hl=en', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await res.text();
  console.log('status', res.status, 'len', html.length);
  console.log('consent', html.includes('consent.google'), 'unusual', html.includes('unusual traffic'));

  const ou = [...html.matchAll(/"ou":"(https:\\\/\\\/[^"]+)"/g)];
  const ou2 = [...html.matchAll(/"ou":"(https:\/\/[^"]+)"/g)];
  const imgurl = [...html.matchAll(/imgurl=([^&"]+)/g)];
  console.log('ou escaped', ou.length, ou[0]?.[1]?.slice(0, 80));
  console.log('ou plain', ou2.length, ou2[0]?.[1]?.slice(0, 80));
  console.log('imgurl', imgurl.length, imgurl[0]?.[1]?.slice(0, 80));

  // Google web search
  const res2 = await fetch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&safe=off&hl=en', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const html2 = await res2.text();
  const links = [...html2.matchAll(/href="\/url\?q=([^&"]+)/g)].slice(0, 5);
  console.log('web links', links.length, decodeURIComponent(links[0]?.[1] || ''));

  // Google video
  const res3 = await fetch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&tbm=vid&safe=off&hl=en', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const html3 = await res3.text();
  const vlinks = [...html3.matchAll(/href="\/url\?q=([^&"]+)/g)].slice(0, 5);
  console.log('video links', vlinks.length, decodeURIComponent(vlinks[0]?.[1] || ''));
}

test().catch(console.error);
