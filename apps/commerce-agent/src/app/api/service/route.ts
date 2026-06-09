import { getChargeRoute } from '@/lib/mppx-server';

export async function GET(request: Request) {
  const result = await getChargeRoute()(request);

  if (result.status === 402) {
    return result.challenge;
  }

  const data = await fetchWeatherData();
  return result.withReceipt(Response.json(data));
}

async function fetchWeatherData() {
  try {
    const res = await fetch('https://wttr.in/London?format=j1');
    const json = await res.json();
    const current = json.current_condition[0];
    return {
      city: 'London',
      temp_c: current.temp_C,
      condition: current.weatherDesc[0].value,
      humidity: current.humidity,
      wind_kmph: current.windspeedKmph,
    };
  } catch {
    return { city: 'London', temp_c: '14', condition: 'Partly cloudy', humidity: '65', wind_kmph: '15' };
  }
}
