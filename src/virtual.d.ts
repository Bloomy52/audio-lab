declare module "virtual:dependencies" {
  const dependencies: { name: string; version: string; dev: boolean }[];
  export default dependencies;
}
