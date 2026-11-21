import { Asset, resources } from 'cc';

/**
 * 读取 resources 下一个目录里的全部资源，按文件名（不含扩展名）返回。
 *
 * 不能直接用 asset.name：Cocos 3.8 的 ImageAsset 存档时不保存名字，运行时 name 是空字符串，
 * 所有图片会挤到同一个键上。这里按资源路径取文件名（路径里有名字），再用 uuid 对上加载结果。
 */
export function loadDirByName<T extends Asset>(
  dir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: new (...args: any[]) => T,
  done: (err: Error | null, byName: Record<string, T>) => void,
): void {
  const nameByUuid: Record<string, string> = {};
  for (const info of resources.getDirWithPath(dir, type)) {
    nameByUuid[info.uuid] = info.path.slice(info.path.lastIndexOf('/') + 1);
  }
  resources.loadDir(dir, type, (err: Error | null, assets: T[]) => {
    const byName: Record<string, T> = {};
    for (const a of assets || []) {
      const name = nameByUuid[a.uuid] || a.name;
      if (name) byName[name] = a;
    }
    done(err, byName);
  });
}
