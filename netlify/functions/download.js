const DEFAULT_COOKIE = "ndus=Y2YqaCTteHuiU3Ud_MYU7vHoVW4DNBi0MPmg_1tQ" // Fallback cookie

function getHeaders(cookie) {
  return {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
    "Connection": "keep-alive",
    "Cookie": cookie || DEFAULT_COOKIE,
    "Host": "www.teraboxapp.com",
    "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Microsoft Edge";v="133", "Chromium";v="133"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0"
  };
}

function getSize(sizeBytes) {
  if (sizeBytes >= 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(2)} KB`;
  }
  return `${sizeBytes} bytes`;
}

function findBetween(str, start, end) {
  const startIndex = str.indexOf(start) + start.length;
  const endIndex = str.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) return "";
  return str.slice(startIndex, endIndex);
}

function extractTokens(text) {
  const jsTokenMatch = text.match(/fn%28%22([^%]+)%22%29/) || 
                       text.match(/jsToken\s*=\s*"([^"]+)"/) ||
                       text.match(/fn\("([^"]+)"\)/);
  
  const bdsTokenMatch = text.match(/bdstoken":"([^"]+)"/) ||
                        text.match(/bdstoken\s*=\s*"([^"]+)"/);
                        
  const logidMatch = text.match(/dp-logid=([^&" ]+)/) ||
                     text.match(/"dp-logid":"([^"]+)"/);

  let jsToken = jsTokenMatch ? jsTokenMatch[1] : "";
  let bdsToken = bdsTokenMatch ? bdsTokenMatch[1] : "";
  let logid = logidMatch ? logidMatch[1] : "";

  // Try to find in templateData if JSON
  if (!bdsToken || !logid) {
    const templateMatch = text.match(/var\s+templateData\s*=\s*({.+?});/);
    if (templateMatch) {
        try {
            const dataStr = templateMatch[1];
            const bdsMatch = dataStr.match(/"bdstoken":"([^"]+)"/);
            const logidMatchJson = dataStr.match(/"dp-logid":"([^"]+)"/);
            if (bdsMatch) bdsToken = bdsToken || bdsMatch[1];
            if (logidMatchJson) logid = logid || logidMatchJson[1];
        } catch (e) {}
    }
  }

  return { jsToken, bdsToken, logid };
}

async function getFileInfo(link, event, cookie) {
  try {
    if (!link) {
      return { error: "Invalid request parameters." };
    }

    const headers = getHeaders(cookie);
    let response = await fetch(link, { headers });
    if (!response.ok) {
      console.error(`Failed to fetch initial link: ${response.status}`);
      return { error: "Unable to process the request. Please check your cookies and try again." };
    }

    const finalUrl = response.url;
    const url = new URL(finalUrl);
    const surl = url.searchParams.get("surl");
    if (!surl) {
      console.error("No surl found in URL");
      return { error: "Invalid link format. Please provide a valid TeraBox link." };
    }

    response = await fetch(finalUrl, { headers });
    const text = await response.text();

    const { jsToken, bdsToken, logid } = extractTokens(text);

    if (!jsToken || !logid || !bdsToken) {
      console.error("Failed to extract tokens (Enhanced):", { jsToken: !!jsToken, logid: !!logid, bdstoken: !!bdsToken });
      return { error: "Authentication failed. Please check your cookies and try again." };
    }

    const params = new URLSearchParams({
      app_id: "250528",
      web: "1",
      channel: "dubox",
      clienttype: "0",
      jsToken: jsToken,
      "dp-logid": logid,
      page: "1",
      num: "20",
      by: "name",
      order: "asc",
      site_referer: finalUrl,
      shorturl: surl,
      root: "1,",
    });

    const listApiUrl = `https://www.teraboxapp.com/share/list?${params}`;
    response = await fetch(listApiUrl, { headers });
    const data = await response.json();

    if (!data || !data.list || !data.list.length || data.errno) {
      console.error("API error:", data.errno, data.errmsg);
      return { error: "Unable to retrieve file information. Please verify your cookies are valid." };
    }

    const fileInfo = data.list[0];
    
    return {
      file_name: fileInfo.server_filename || "",
      download_link: fileInfo.dlink || "",
      thumbnail: fileInfo.thumbs?.url3 || "",
      file_size: getSize(parseInt(fileInfo.size || 0)),
      size_bytes: parseInt(fileInfo.size || 0),
      proxy_url: `/api/proxy?url=${encodeURIComponent(fileInfo.dlink)}&filename=${encodeURIComponent(fileInfo.server_filename || 'download')}&cookie=${encodeURIComponent(cookie)}`,
    };
  } catch (error) {
    console.error("Error in getFileInfo:", error.message);
    return { error: "A generic error occurred. Please try again." };
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Content-Length"
};

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Only handle POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify({ error: "Method not allowed. Use POST request." })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { link, cookies } = body;
    
    if (!link) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        body: JSON.stringify({ error: "Missing required parameter: link" })
      };
    }

    if (!cookies) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        body: JSON.stringify({ error: "Missing required parameter: cookies" })
      };
    }

    const fileInfo = await getFileInfo(link, event, cookies);
    return {
      statusCode: fileInfo.error ? 400 : 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify(fileInfo)
    };
  } catch (error) {
    console.error("Download API error:", error.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify({ error: "Internal server error. Please try again." })
    };
  }
};
