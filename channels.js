// 版本命名規則：西元年月日_v01（每日編輯重置為當天日期，同日遞增 v02, v03...，隔日歸為 v01）
const APP_VERSION = '20261127_v06';

const IC_VOICE_REVMA_URL = 'https://stream.rcs.revma.com/7mnq8rt7k5zuv';

const defaultChannels = [
  { id: 'ch1',  name: '中廣音樂網', sub: 'iRadio',   url: 'https://sonnykuo.appspot.com/bcc/?id=中廣音樂網', fav: true },
  { id: 'ch2',  name: '中廣新聞網', sub: 'News',     url: 'https://sonnykuo.appspot.com/bcc/?id=中廣新聞網', fav: false },
  { id: 'ch3',  name: '中廣流行網', sub: 'I Like',   url: 'https://sonnykuo.appspot.com/bcc/?id=中廣流行網', fav: false },
  { id: 'ch4',  name: '古典 97.7',  sub: 'FM 97.7',  url: 'https://onair.family977.com.tw:8977/live.mp3', fav: true },
  { id: 'ch5',  name: 'Bravo 91.3', sub: 'FM 91.3',  url: 'https://onair.family977.com.tw:8977/live.mp3', fav: false },
  { id: 'ch6',  name: '飛碟聯播網', sub: 'FM 92.1',  url: 'https://stream.rcs.revma.com/em90w4aeewzuv.m4a', fav: true },
  { id: 'ch7',  name: 'News98',     sub: 'FM 98.1',  url: 'https://stream.rcs.revma.com/pntx1639ntzuv.m4a', fav: false },
  { id: 'ch8',  name: '全國廣播',   sub: 'FM 106.1', url: 'https://stream.rcs.revma.com/044q61ha7a0uv', fav: false },
  { id: 'ch9',  name: '佳音聯播',   sub: 'FM 90.9',  url: 'https://stream.ginnet.cloud/live0119lo-p4rb/_definst_/fm909/playlist.m3u8', fav: false },
  { id: 'ch10', name: '台北愛樂',   sub: 'FM 99.7',  url: 'https://stream.rcs.revma.com/sw7168857a0uv', fav: false },
  { id: 'ch11', name: 'IC 之音',    sub: 'FM 97.5',  url: IC_VOICE_REVMA_URL, fav: true },
  { id: 'ch12', name: '警察廣播',   sub: '全國治安', url: 'https://stream.pbs.gov.tw/live/TPS/playlist.m3u8', fav: false }
];
