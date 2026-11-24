type ClassNames = (string | boolean | undefined | null)[];

type NameMap = Record<string, boolean | undefined | null>;

function classes(...names: ClassNames): string;
function classes(nameMap: NameMap): string;
function classes(...args: any[]): string {
  if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const nameMap: NameMap = args[0];
    return Object.keys(nameMap)
      .filter(key => nameMap[key])
      .join(' ');
  } else {
    const names: ClassNames = args;
    return names
      .filter(Boolean)
      .join(' ');
  }
}

export default classes;