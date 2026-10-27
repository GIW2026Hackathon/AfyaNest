import { createContext, useContext } from 'react'

const en = {
  tagline: 'Clean air, warm chicks, every night.',
  signIn: 'Sign in', signUp: 'Create account', email: 'Email', password: 'Password',
  yourName: 'Your name', orgName: 'Farm or co-operative name', continue: 'Continue',
  newHere: 'New to AfyaNest?', haveAccount: 'Already have an account?',
  mfaTitle: 'Two-step verification', mfaHelp: 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.',
  verify: 'Verify', back: 'Back', signOut: 'Sign out',
  farms: 'Farms', security: 'Security', team: 'Team', platform: 'Platform',
  overview: 'Overview', addHouse: 'Add poultry house', houses: 'poultry houses',
  ammonia: 'Ammonia', temperature: 'Temperature', humidity: 'Humidity',
  now: 'now', online: 'Online', offline: 'Offline', lastSeen: 'Last data',
  ok: 'All good', watch: 'Watch', warn: 'Warning', danger: 'Danger', nodata: 'No data yet', warming: 'Learning',
  advice: "Today's advice", ifNothing: 'If nothing changes', ifFollow: 'If you follow the advice',
  peakIn6h: 'peak in next 6 h', coldest: 'coldest bird zone',
  forecast: '6-hour forecast', history: 'History', zones: 'Zones', house: 'House',
  heatmap: 'Ammonia across the house', diurnal: 'Daily rhythm', comfort: 'Comfort map',
  exposure: 'Time in danger', alerts: 'SMS sent to the farmer', floor: 'House map',
  birdsAge: 'Bird age', days: 'days', birds: 'birds', fan: 'Fan', curtain: 'Curtain',
  hours: 'hours', range: 'Range', settings: 'Settings', save: 'Save', cancel: 'Cancel',
  deviceKey: 'Gateway key', rotateKey: 'Rotate key', delete: 'Delete',
  outbreaks: 'Outbreak watch', synthetic: 'Synthetic data', nextCheck: 'Next check-in',
}

const sw = {
  ...en,
  tagline: 'Hewa safi, vifaranga wenye joto, kila usiku.',
  signIn: 'Ingia', signUp: 'Fungua akaunti', email: 'Barua pepe', password: 'Nenosiri',
  yourName: 'Jina lako', orgName: 'Jina la shamba au chama', continue: 'Endelea',
  newHere: 'Mgeni kwenye AfyaNest?', haveAccount: 'Una akaunti tayari?',
  mfaTitle: 'Uthibitisho wa hatua mbili', mfaHelp: 'Weka namba 6 kutoka kwenye programu yako ya uthibitisho, au moja ya namba zako za akiba.',
  verify: 'Thibitisha', back: 'Rudi', signOut: 'Toka',
  farms: 'Mashamba', security: 'Usalama', team: 'Timu', platform: 'Jukwaa',
  overview: 'Muhtasari', addHouse: 'Ongeza banda', houses: 'mabanda ya kuku',
  ammonia: 'Amonia', temperature: 'Joto', humidity: 'Unyevu',
  now: 'sasa', online: 'Mtandaoni', offline: 'Nje ya mtandao', lastSeen: 'Data ya mwisho',
  ok: 'Salama', watch: 'Tahadhari', warn: 'Onyo', danger: 'Hatari', nodata: 'Hakuna data bado', warming: 'Inajifunza',
  advice: 'Ushauri wa leo', ifNothing: 'Usipobadilisha kitu', ifFollow: 'Ukifuata ushauri',
  peakIn6h: 'kilele saa 6 zijazo', coldest: 'eneo baridi zaidi',
  forecast: 'Utabiri wa saa 6', history: 'Historia', zones: 'Maeneo', house: 'Banda',
  heatmap: 'Amonia ndani ya banda', diurnal: 'Mzunguko wa siku', comfort: 'Ramani ya starehe',
  exposure: 'Muda wa hatari', alerts: 'SMS zilizotumwa kwa mfugaji', floor: 'Ramani ya banda',
  birdsAge: 'Umri wa kuku', days: 'siku', birds: 'kuku', fan: 'Feni', curtain: 'Pazia',
  hours: 'saa', range: 'Muda', settings: 'Mipangilio', save: 'Hifadhi', cancel: 'Ghairi',
  deviceKey: 'Ufunguo wa kifaa', rotateKey: 'Badilisha ufunguo', delete: 'Futa',
  outbreaks: 'Milipuko ya magonjwa', synthetic: 'Data ya majaribio', nextCheck: 'Angalia banda saa',
}

export const DICTS = { en, sw }
export const LangContext = createContext({ t: en, lang: 'en', setLang: () => {} })
export const useT = () => useContext(LangContext)

export const ZONE_LABEL = {
  en: { brooder: 'Brooder', drinker_a: 'Drinker A', drinker_b: 'Drinker B', centre: 'Centre', curtain_west: 'Curtain side', exhaust_east: 'Fan end' },
  sw: { brooder: 'Vifaranga', drinker_a: 'Maji A', drinker_b: 'Maji B', centre: 'Katikati', curtain_west: 'Upande wa pazia', exhaust_east: 'Upande wa feni' },
}
