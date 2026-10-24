// 사진 파일 저장소. DB에는 storage_key만 두고 URL은 요청마다 서명해서 내보낸다.
// MEA-8에서 Supabase Storage 구현으로 교체한다. 그 전에는 저장소가 없으므로 URL은 null.
export abstract class PhotoStorage {
  abstract signedUrl(storageKey: string): Promise<string | null>;
  abstract remove(storageKeys: string[]): Promise<void>;
}

export class NoopPhotoStorage extends PhotoStorage {
  signedUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }
}
