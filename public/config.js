// =====================================================================
//  Inställningar – fyll i innan publicering (se README.md)
//  Efter ändring: höj VERSION i sw.js så att telefonerna hämtar nya filen.
// =====================================================================
window.LOPPIS_CONFIG = {
  // Supabase → Project Settings → API
  supabaseUrl: 'https://DITT-PROJEKT.supabase.co',
  supabaseAnonKey: 'DIN-ANON-PUBLIC-NYCKEL',

  // Föreningens Swish Företag-nummer, bara siffror
  swishNumber: '1234567890',

  storeName: 'Rydebäcks Barnloppis',

  // Hur ofta utgångsstationerna skickar kontrollerade köp (minuter)
  stationSyncMinutes: 5
};
