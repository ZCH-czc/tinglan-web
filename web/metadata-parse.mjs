import { parseBlob, selectCover } from 'music-metadata';

const text = (value, limit = 2000) => typeof value === 'string' ? value.replaceAll('\u0000', '').trim().slice(0, limit) : '';
export async function extractMetadata(file) {
  // Blob slicing and parser allocation limits avoid decoding or scanning the complete audio.
  const { common, format } = await parseBlob(file, { duration: false, skipCovers: false, skipPostHeaders: false, maxBufferSize: 8 * 1024 * 1024 });
  const picture = selectCover(common.picture);
  const cover = picture?.data?.length && picture.data.length <= 8 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/i.test(picture.format)
    ? new Blob([picture.data], { type: picture.format }) : null;
  const duration = Number(format.duration);
  const lyrics = (common.lyrics || []).map(value => typeof value === 'string' ? value : value?.text || '').filter(Boolean).join('\n').slice(0, 200_000);
  return {
    audioDetected:Number(format.sampleRate)>0 || Number(format.numberOfChannels)>0,
    title: text(common.title), artist: text(common.artist || common.artists?.join('、')),
    album: text(common.album), albumArtist: text(common.albumartist),
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.min(2_592_000_000, Math.round(duration * 1000)) : 0,
    trackNumber: Number.isSafeInteger(common.track?.no) ? common.track.no : 0,
    year: Number.isSafeInteger(common.year) ? common.year : 0,
    lyrics, cover,
  };
}
