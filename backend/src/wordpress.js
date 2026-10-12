import { Property } from './models.js';
export async function syncWordPressProperties() {
  const root = process.env.WORDPRESS_URL?.replace(/\/$/, ''); if (!root) throw new Error('WORDPRESS_URL is not configured');
  const headers = {};
  if (process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_APP_PASSWORD) headers.Authorization = `Basic ${Buffer.from(`${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_APP_PASSWORD.replace(/\s/g, '')}`).toString('base64')}`;
  const endpoints = process.env.WORDPRESS_PROPERTY_ENDPOINT ? [process.env.WORDPRESS_PROPERTY_ENDPOINT] : ['/wp-json/wp/v2/property', '/wp-json/wp/v2/properties'];
  let response;
  for (const endpoint of endpoints) {
    response = await fetch(`${root}${endpoint.startsWith('/') ? '' : '/'}${endpoint}?per_page=100&_embed`, { headers });
    if (response.ok || response.status !== 404) break;
  }
  if (!response?.ok) throw new Error(`WordPress returned HTTP ${response?.status || 'unavailable'}; check WORDPRESS_PROPERTY_ENDPOINT and credentials.`);
  const items = await response.json();
  for (const item of items) {
    const meta = item.meta || {}; const media = item._embedded?.['wp:featuredmedia']?.[0]?.source_url;
    await Property.findOneAndUpdate({ wpId: item.id }, { wpId: item.id, title: item.title?.rendered?.replace(/<[^>]+>/g, '') || 'Property', price: meta.price || meta.property_price || '', location: meta.location || meta.property_location || '', type: meta.property_type || '', status: meta.status || '', bedrooms: Number(meta.bedrooms) || undefined, bathrooms: Number(meta.bathrooms) || undefined, image: media || '', url: item.link, excerpt: item.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '' }, { upsert: true, new: true });
  }
  return { count: items.length };
}
