/** Chave do arquivo original enviado pelo usuário. */
export function originalKey(videoId: string): string {
  return `videos/${videoId}/original`;
}

/** Chave da thumbnail gerada pelo worker. */
export function thumbnailKey(videoId: string): string {
  return `videos/${videoId}/thumbnail.jpg`;
}
