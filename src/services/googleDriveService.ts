import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
];

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

// Keep OAuth access token strictly in memory
let cachedAccessToken: string | null = null;

function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  SCOPES.forEach((scope) => provider.addScope(scope));
  return provider;
}

export function initGoogleDriveAuth(
  callback: (user: User | null, hasToken: boolean) => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
    }
    callback(user, Boolean(cachedAccessToken));
  });
}

export async function googleSignIn(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  const provider = createGoogleProvider();
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedAccessToken = credential.accessToken;
  }
  return { user: result.user, accessToken: cachedAccessToken };
}

export async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }
  const { accessToken } = await googleSignIn();
  if (!accessToken) {
    throw new Error('Failed to retrieve Google Drive OAuth access token.');
  }
  return accessToken;
}

export async function googleLogout(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth);
}

export interface GoogleDriveBackupFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

export async function listGoogleDriveBackups(): Promise<GoogleDriveBackupFile[]> {
  let token = await getGoogleAccessToken();
  const query = encodeURIComponent(
    "trashed = false and (name contains 'smartolt' or name contains 'jetcybernet' or name contains 'olt-' or mimeType = 'application/json')"
  );
  const url = `https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime desc&q=${query}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)`;

  let response = await window.fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    token = await getGoogleAccessToken();
    response = await window.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Drive API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return Array.isArray(data.files) ? data.files : [];
}

export async function uploadFileToGoogleDrive(
  fileName: string,
  content: string,
  mimeType: 'application/json' | 'text/plain' = 'application/json'
): Promise<GoogleDriveBackupFile> {
  let token = await getGoogleAccessToken();

  const metadata = {
    name: fileName,
    mimeType,
    description: 'SmartOLT GPON Manager Backup File',
  };

  const buildMultipartForm = () => {
    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', new Blob([content], { type: mimeType }));
    return form;
  };

  const uploadUrl =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink';

  let response = await window.fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: buildMultipartForm(),
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    token = await getGoogleAccessToken();
    response = await window.fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: buildMultipartForm(),
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Upload gagal (${response.status}): ${errText}`);
  }

  return await response.json();
}

export async function downloadGoogleDriveFileText(fileId: string): Promise<string> {
  let token = await getGoogleAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media`;

  let response = await window.fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    token = await getGoogleAccessToken();
    response = await window.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Download gagal (${response.status}): ${errText}`);
  }

  return await response.text();
}

export async function deleteGoogleDriveFile(fileId: string): Promise<void> {
  let token = await getGoogleAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}`;

  let response = await window.fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    token = await getGoogleAccessToken();
    response = await window.fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!response.ok && response.status !== 204) {
    const errText = await response.text();
    throw new Error(`Hapus file gagal (${response.status}): ${errText}`);
  }
}
