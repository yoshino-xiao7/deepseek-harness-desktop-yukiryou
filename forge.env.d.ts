declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const PET_PLAYER_VITE_DEV_SERVER_URL: string | undefined;
declare const PET_PLAYER_VITE_NAME: string;
declare const PET_MEDIA_WORKER_VITE_DEV_SERVER_URL: string | undefined;
declare const PET_MEDIA_WORKER_VITE_NAME: string;

declare module '*?url' {
  const dataUrl: string;
  export default dataUrl;
}
