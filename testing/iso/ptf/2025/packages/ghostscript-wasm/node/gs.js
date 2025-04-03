import GhostscriptModule from "../gs.js"; // ESM
import { fileURLToPath, pathToFileURL } from "url";

export async function run(
  args,
  {
    basePath = pathToFileURL(process.cwd()),
    mountPath = "/working",
    // mounts = [['NODEFS', basePath, '/working']],
    options,
  } = {}
) {
  // const { default: GhostscriptModule } = await GhostscriptModulePromise;
  const module = await GhostscriptModule(options);
  // const working = '/working';node
  if (mountPath) {
    module.FS.mkdir(mountPath);
    module.FS.mount(
      module.NODEFS,
      { root: fileURLToPath(basePath) },
      mountPath
    );
    module.FS.chdir(mountPath);
  }
  return module.callMain(args);
}

export { GhostscriptModule };
