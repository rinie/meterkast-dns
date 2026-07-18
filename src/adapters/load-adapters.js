export async function loadAdapters(paths) {
  const modules = await Promise.all(paths.map((path) => import(path)));
  return modules.map((mod) => mod.default ?? mod);
}
