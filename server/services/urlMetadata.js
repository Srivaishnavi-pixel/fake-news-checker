import * as cheerio from 'cheerio';

// Known reputable international outlets and wire services
export const REPUTABLE_DOMAINS = new Set([
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'afp.com',
  'npr.org',
  'pbs.org',
  'theguardian.com',
  'nytimes.com',
  'wsj.com',
  'washingtonpost.com',
  'bloomberg.com',
  'aljazeera.com',
  'dw.com',
  'nature.com',
  'science.org',
  'snopes.com',
  'politifact.com',
  'factcheck.org'
]);

// Known satire and parody publications
export const SATIRE_DOMAINS = new Set([
  'theonion.com',
  'babylonbee.com',
  'clickhole.com',
  'borowitzreport.com',
  'newsthump.com',
  'thebeaverton.com',
  'duffelblog.com',
  'waterfordwhispersnews.com'
]);

// Target brand names commonly impersonated via typosquatting
const SENSITIVE_BRANDS = ['reuters', 'apnews', 'bbc', 'cnn', 'nytimes', 'guardian', 'washingtonpost', 'bloomberg'];

/**
 * Checks if a domain looks like a typosquatted or deceptive mimic of a reputable news outlet.
 */
export function checkTyposquatting(hostname) {
  const cleanHost = hostname.toLowerCase().replace(/^www\./, '');

  for (const brand of SENSITIVE_BRANDS) {
    if (cleanHost.includes(brand)) {
      // If it's the exact legitimate domain or its official subdomain
      if (
        cleanHost === `${brand}.com` ||
        cleanHost === `${brand}.co.uk` ||
        cleanHost === `${brand}.org` ||
        cleanHost.endsWith(`.${brand}.com`) ||
        cleanHost.endsWith(`.${brand}.co.uk`)
      ) {
        continue;
      }

      // Deceptive patterns like bbc-news.co, reuters-breaking.top, cnn.world.live
      return {
        isTyposquat: true,
        impersonatedBrand: brand,
        reason: `The domain "${cleanHost}" contains the name "${brand}", but does not match the official domain. This is often a sign of typosquatting or source impersonation.`
      };
    }
  }

  return { isTyposquat: false };
}

/**
 * Categorizes the domain into reputable, satire, suspicious, or unknown.
 */
export function analyzeDomain(hostname) {
  const cleanHost = hostname.toLowerCase().replace(/^www\./, '');

  if (SATIRE_DOMAINS.has(cleanHost)) {
    return {
      category: 'satire',
      isSatire: true,
      isReputable: false,
      notes: `Known satire / parody publication (${cleanHost}). Articles are meant for humor and should not be treated as factual reporting.`
    };
  }

  if (REPUTABLE_DOMAINS.has(cleanHost)) {
    return {
      category: 'reputable',
      isSatire: false,
      isReputable: true,
      notes: `Established and widely recognized news/fact-checking outlet (${cleanHost}).`
    };
  }

  const typoCheck = checkTyposquatting(cleanHost);
  if (typoCheck.isTyposquat) {
    return {
      category: 'suspicious',
      isSatire: false,
      isReputable: false,
      notes: typoCheck.reason
    };
  }

  return {
    category: 'unknown',
    isSatire: false,
    isReputable: false,
    notes: `Independent or lesser-known domain (${cleanHost}). Requires additional verification of editorial standards.`
  };
}

/**
 * Fetches and parses metadata from a given URL.
 */
export async function fetchUrlMetadata(targetUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    throw new Error('Invalid URL format');
  }

  const domainAnalysis = analyzeDomain(parsedUrl.hostname);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        url: targetUrl,
        domain: parsedUrl.hostname,
        domainAnalysis,
        fetched: false,
        status: response.status,
        error: `Could not fetch page (HTTP ${response.status})`
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text().trim() ||
      '';

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      '';

    const author =
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('meta[name="byl"]').attr('content') ||
      $('[rel="author"]').first().text().trim() ||
      $('.author-name, .byline').first().text().trim() ||
      '';

    const publishDate =
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="pubdate"]').attr('content') ||
      $('meta[name="date"]').attr('content') ||
      $('time[datetime]').first().attr('datetime') ||
      $('time').first().text().trim() ||
      '';

    let dateAgeDays = null;
    let isOlderStory = false;
    if (publishDate) {
      const parsedDate = new Date(publishDate);
      if (!isNaN(parsedDate.getTime())) {
        const diffMs = Date.now() - parsedDate.getTime();
        dateAgeDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        // Flag stories older than 180 days (6 months)
        if (dateAgeDays > 180) {
          isOlderStory = true;
        }
      }
    }

    return {
      url: targetUrl,
      domain: parsedUrl.hostname,
      domainAnalysis,
      fetched: true,
      title: title.replace(/\s+/g, ' ').trim(),
      description: description.replace(/\s+/g, ' ').trim(),
      author: author.replace(/\s+/g, ' ').trim(),
      publishDate: publishDate.trim(),
      dateAgeDays,
      isOlderStory
    };
  } catch (err) {
    return {
      url: targetUrl,
      domain: parsedUrl.hostname,
      domainAnalysis,
      fetched: false,
      error: err.name === 'AbortError' ? 'Fetch timed out' : err.message
    };
  }
}
