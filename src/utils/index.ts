import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import Database from '@tauri-apps/plugin-sql';
import toast from "./toast";

export const sql = Database;

export const CNDateToDate = (date?: string) => {
  if (!date) return null;
  return new Date(date.replace(/年|月/g, "-").replace(/日/g, ""));
}

export const CNDateToDateString = (date?: string) => {
  return date?.replace(/年|月/g, "-").replace(/日/g, "") || "";
}

export function getExtOfFile(fileName: string): string {
  return (fileName || "").split(".").pop() || "";
}

export function getNameOfFilePath(filePath: string): string {
  return (filePath || "").split(/[/\\]/).pop() || "";
}

export function getNameWithoutExt(filePath: string): string {
  return getNameOfFilePath(filePath).replace(/\.\w+$/, "");
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type InvokeMap = {
  get_appdir: {
    args: undefined;
    returns: string;
  };
  is_dev: {
    args: undefined;
    returns: boolean;
  };
  open_directory_in_fs: {
    args: { path: string };
    returns: void;
  };
  get_locales: {
    args: undefined;
    returns: Record<string, string>;
  };
  get_locale_messages: {
    args: { locale: string };
    returns: Record<string, string>;
  },
};

/**
 * ### read_image
 * @returns {ArrayBufferLike}
 * @text_format
 *
 * - "txt": url
 * - "url":
 * ```text
 * [InternetShortcut]
 * URL=https://v1.tauri.app/meta/tauri_logo_light.svg
 * ```
 */
export async function invoke<T extends InvokeMap[K]["returns"], K extends keyof InvokeMap>(
  cmd: K,
  args?: InvokeMap[K]["args"],
  catchError?: boolean,
  $?: Function
): Promise<InvokeMap[K]["returns"]> {
  if (catchError) {
    try {
      return await tauriInvoke<T>(cmd, args);
    } catch (error) {
      const err = error as Error;
      console.error("invoke error", cmd, args, err);
      toast.error(err.message || err.name || (typeof err === "string" ? err : $ ? $("Unknown error") : "Unknown error"));
      return null as any;
    }
  } else {
    return tauriInvoke<T>(cmd, args);
  }
}

const NumericExp = new RegExp(/^\d+$/);
export const isNumeric = (str: string) => NumericExp.test(str);

export const getColorScheme = () => {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
};

/**
 * @format 1.0.0 | v1.0.0 | v1.0.0-beta
 * @suffix `alpha` < `beta` < `rc` < `release` = ""
 */
export const compareVersion = (v1: string, v2: string): number => {
  console.log("compareVersion", v1, v2);
  const parseVersion = (version: string) => {
    const [main, suffix] = version.split("-");
    const [major, minor, patch] = main.split(".").map(Number);
    return { major, minor, patch, suffix: suffix || "" };
  };

  const suffixOrder = ["alpha", "beta", "rc", "release", ""];

  const v1Parsed = parseVersion(v1);
  const v2Parsed = parseVersion(v2);

  if (v1Parsed.major !== v2Parsed.major) {
    return v1Parsed.major - v2Parsed.major;
  }
  if (v1Parsed.minor !== v2Parsed.minor) {
    return v1Parsed.minor - v2Parsed.minor;
  }
  if (v1Parsed.patch !== v2Parsed.patch) {
    return v1Parsed.patch - v2Parsed.patch;
  }

  const v1SuffixIndex = suffixOrder.indexOf(v1Parsed.suffix);
  const v2SuffixIndex = suffixOrder.indexOf(v2Parsed.suffix);

  return v1SuffixIndex - v2SuffixIndex;
};

export const validateURL = (str: string): boolean => {
  const urlRegex = /(https?:\/\/)?[-a-zA-Z0-9.@:%_+~#=]{1,256}\.[a-zA-Z0-9.-]{1,63}\b([-a-zA-Z0-9@:%_+.~#?&\/]*)?/g;
  return urlRegex.test(str);
};