export const PET_PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 24 * 1024 * 1024,
  expandedBytes: 96 * 1024 * 1024,
  fileCount: 64,
  entryBytes: 64 * 1024 * 1024,
  manifestBytes: 128 * 1024,
  pathBytes: 240,
  pathDepth: 8,
  entryCompressionRatio: 100,
  archiveCompressionRatio: 40,
  thumbnailBytes: 1024 * 1024,
  thumbnailPixels: 1024 * 1024,
} as const);

export const PET_MOTIONS = [
  'standing',
  'drowsy',
  'lying-down',
  'sleeping',
  'waking',
  'rubbing-eyes',
  'work-enter',
  'eating',
  'work-exit',
] as const;

export type PetMotion = typeof PET_MOTIONS[number];

export interface DraftPetPackageSummary {
  readonly schemaVersion: 0;
  readonly id: string;
  readonly name: Readonly<{ 'zh-CN': string; en: string }>;
  readonly author: string;
  readonly license: string;
  readonly source: string;
  readonly packageContentHash: string;
  readonly fileCount: number;
  readonly expandedBytes: number;
}

export type PetPackageRejectionReason =
  | 'invalid-zip'
  | 'invalid-manifest'
  | 'inventory-mismatch'
  | 'hash-mismatch'
  | 'archive-too-large'
  | 'file-count'
  | 'entry-too-large'
  | 'expanded-too-large'
  | 'compression-ratio'
  | 'duplicate-path'
  | 'link-entry'
  | 'prohibited-file'
  | 'unsafe-path';

export type PetPackagePreflightResult =
  | { readonly status: 'accepted'; readonly package: DraftPetPackageSummary }
  | {
      readonly status: 'rejected';
      readonly code: 'pet-package-invalid' | 'pet-package-too-large' | 'pet-package-unsafe';
      readonly reason: PetPackageRejectionReason;
    };
