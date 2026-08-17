export interface RendererLocationInput {
  readonly isPackaged: boolean;
  readonly developmentServerUrl: string | undefined;
  readonly packagedRendererUrl: string;
}

export type RendererLocation =
  | { readonly kind: 'url'; readonly value: string }
  | { readonly kind: 'file'; readonly value: string };

export function resolveRendererLocation(
  input: RendererLocationInput,
): RendererLocation {
  if (input.isPackaged && input.developmentServerUrl !== undefined) {
    throw new Error('Production cannot load a development server URL');
  }

  if (input.developmentServerUrl !== undefined) {
    return { kind: 'url', value: input.developmentServerUrl };
  }

  return { kind: 'file', value: input.packagedRendererUrl };
}
