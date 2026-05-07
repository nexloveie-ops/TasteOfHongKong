import https from 'https';

type GeocodeJson = {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
  }>;
};

function httpsGetJson(url: string): Promise<GeocodeJson> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(d) as GeocodeJson);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

export async function googleGeocodeAddress(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
  const body = await httpsGetJson(url);
  if (body.status !== 'OK' || !body.results?.[0]) {
    return null;
  }
  const loc = body.results[0].geometry?.location;
  const formatted = body.results[0].formatted_address;
  if (loc == null || typeof formatted !== 'string') return null;
  return { lat: loc.lat, lng: loc.lng, formattedAddress: formatted };
}
