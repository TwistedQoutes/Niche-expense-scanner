'use client';

import { FileKind } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

export type JobPhoto = {
  id: string;
  kind: FileKind;
  fileName: string;
  mimeType: string;
  bytes: number;
  caption: string | null;
  createdAt: string | Date;
};

export type JobPhotosProps = {
  jobId: string;
  photos: JobPhoto[];
  /** False when the deployment has no storage configured; the control is hidden. */
  storageConfigured: boolean;
  /** ADMIN and up may remove a photo. */
  canDelete: boolean;
  maxBytes: number;
};

const KIND_LABEL: Record<string, string> = {
  [FileKind.JOB_BEFORE]: 'Before',
  [FileKind.JOB_AFTER]: 'After',
};

/**
 * Before-and-after photographs, on the job they belong to.
 *
 * Images are loaded from `/api/files/{id}`, which authorises every byte, rather
 * than from a public URL — so a photograph of somebody's back garden is readable
 * by the business that took it and nobody else.
 */
export function JobPhotos(props: JobPhotosProps) {
  const router = useRouter();
  const toast = useToast();

  const beforeInput = useRef<HTMLInputElement>(null);
  const afterInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: FileKind, file: File) {
    setBusy(kind);
    setError(null);

    if (file.size > props.maxBytes) {
      // Checked here as well as on the server, only so the person holding the
      // phone hears about it before the upload rather than after it.
      setError(
        `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${props.maxBytes / 1024 / 1024} MB.`,
      );
      setBusy(null);
      return;
    }

    const body = new FormData();
    body.set('file', file);
    body.set('kind', kind);

    try {
      // Not `apiRequest`: this is multipart, and that helper is JSON-only. Setting
      // Content-Type by hand would drop the boundary and the body would not parse.
      const response = await fetch(`/api/jobs/${props.jobId}/photos`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string; fieldErrors?: Record<string, string> } }
          | null;
        throw new Error(
          payload?.error?.fieldErrors?.file ??
            payload?.error?.message ??
            'That photo could not be uploaded.',
        );
      }

      toast.success(`${KIND_LABEL[kind]} photo added.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That photo could not be uploaded.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const response = await fetch(`/api/files/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('That photo could not be removed.');
      toast.success('Photo removed.');
      router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const grouped = [FileKind.JOB_BEFORE, FileKind.JOB_AFTER].map((kind) => ({
    kind,
    photos: props.photos.filter((photo) => photo.kind === kind),
  }));

  return (
    <Card>
      <CardHeader
        title="Photos"
        description="Before and after. The only record either side has if a job is ever disputed."
      />

      {!props.storageConfigured ? (
        <Alert tone="info">
          This deployment has no file storage configured, so photos cannot be uploaded yet.
          Set <code>FILE_STORAGE_DRIVER</code> to turn it on.
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {grouped.map(({ kind, photos }) => (
          <section key={kind}>
            <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              {KIND_LABEL[kind]}
            </h3>

            {photos.length === 0 ? (
              <EmptyState
                title={`No ${KIND_LABEL[kind]!.toLowerCase()} photos`}
                description="Add one from the phone that took it."
              />
            ) : (
              <ul className="space-y-2">
                {photos.map((photo) => (
                  <li key={photo.id} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authorised
                        bytes from our own route, not a static asset the optimiser can fetch */}
                    <img
                      src={`/api/files/${photo.id}`}
                      alt={photo.caption ?? `${KIND_LABEL[photo.kind]} photo of this job`}
                      className="block h-40 w-full bg-slate-100 object-cover dark:bg-slate-900"
                      loading="lazy"
                    />
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <p className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {photo.caption ?? photo.fileName}
                      </p>
                      {props.canDelete ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => remove(photo.id)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {props.storageConfigured ? (
              <>
                <input
                  ref={kind === FileKind.JOB_BEFORE ? beforeInput : afterInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Cleared so choosing the same file twice still fires a change.
                    event.target.value = '';
                    if (file) void upload(kind, file);
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={busy !== null}
                  onClick={() =>
                    (kind === FileKind.JOB_BEFORE ? beforeInput : afterInput).current?.click()
                  }
                >
                  {busy === kind ? 'Uploading…' : `Add ${KIND_LABEL[kind]!.toLowerCase()} photo`}
                </Button>
              </>
            ) : null}
          </section>
        ))}
      </div>
    </Card>
  );
}
