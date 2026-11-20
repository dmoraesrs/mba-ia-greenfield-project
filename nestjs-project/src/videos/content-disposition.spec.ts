import { attachmentDisposition } from './content-disposition';

describe('attachmentDisposition', () => {
  it('should keep a plain ASCII filename in both parameters', () => {
    expect(attachmentDisposition('meu-video.mp4')).toBe(
      `attachment; filename="meu-video.mp4"; filename*=UTF-8''meu-video.mp4`,
    );
  });

  it('should replace non-ASCII characters in filename and encode them in filename*', () => {
    expect(attachmentDisposition('férias à beira-mar.mp4')).toBe(
      `attachment; filename="f_rias _ beira-mar.mp4"; filename*=UTF-8''f%C3%A9rias%20%C3%A0%20beira-mar.mp4`,
    );
  });

  it('should strip quotes, slashes, backslashes and control characters', () => {
    const header = attachmentDisposition('../"evil"\\name\r\n.mp4');

    expect(header).toBe(
      `attachment; filename="..evilname.mp4"; filename*=UTF-8''..evilname.mp4`,
    );
  });

  it('should fall back to a default name when nothing safe remains', () => {
    expect(attachmentDisposition('"/\\')).toBe(
      `attachment; filename="video"; filename*=UTF-8''video`,
    );
  });
});
