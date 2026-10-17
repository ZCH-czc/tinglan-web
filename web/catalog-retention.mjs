/** Retain online rows that are still visible or involved in playback/persistence, not past searches. */
export function pruneCatalog(catalog,{sections=[],queue=[],current='',target='',pending=[]}={}) {
  const retained=new Set([...queue,...pending,current,target]);
  for(const section of sections)for(const song of section.songs || [])retained.add(song.id);
  for(const id of catalog.keys())if(!retained.has(id))catalog.delete(id);
}
