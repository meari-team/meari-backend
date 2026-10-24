// 사진 파일 저장소. DB에는 storage_key만 두고 URL은 요청마다 서명해서 내보낸다.
// 지금은 로컬 디스크(LocalPhotoStorage). Supabase로 옮길 때 이 추상 클래스의 구현만 바꾼다.
export abstract class PhotoStorage {
  abstract put(storageKey: string, data: Buffer): Promise<void>;
  abstract read(storageKey: string): Promise<Buffer>;
  abstract signedUrl(storageKey: string): Promise<string | null>;
  abstract remove(storageKeys: string[]): Promise<void>;
}
