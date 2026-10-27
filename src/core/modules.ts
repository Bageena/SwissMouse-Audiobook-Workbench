/** Trusted built-in composition only. This does not load code from a manifest. */
export const moduleContractVersion = 1;
export interface ModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly contractVersion: number;
  readonly resourceKinds: readonly string[];
  readonly workspaces: readonly { readonly id: string; readonly label: string; readonly description: string }[];
}

export function createModuleRegistry() {
  const modules = new Map<string, { manifest: ModuleManifest; screens: unknown }>();
  return {
    register<T>(manifest: ModuleManifest, screens: T) {
      if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) throw new Error('Module IDs must be stable lowercase names.');
      if (manifest.contractVersion !== moduleContractVersion) throw new Error(`Unsupported module contract: ${manifest.contractVersion}`);
      if (modules.has(manifest.id)) throw new Error(`Module already registered: ${manifest.id}`);
      const ids = manifest.workspaces.map(workspace => workspace.id);
      if (new Set(ids).size !== ids.length || ids.some(id => !id.startsWith(manifest.id + '.'))) throw new Error('Workspace IDs must be unique and namespaced by module.');
      const definition = Object.freeze({ manifest, screens });
      modules.set(manifest.id, definition);
      return definition;
    },
    list: () => [...modules.values()].map(module => module.manifest),
  };
}
