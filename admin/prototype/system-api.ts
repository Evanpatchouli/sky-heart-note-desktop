import Resp from "@/models/Resp";
import { SUCCESS_CODE } from "@/constants";
import type * as Roles from "../src/api/role.api";
import type * as Users from "../src/api/user-manage.api";

// The existing system screens use these local adapters only in vite.prototype.config.ts.
const ok = <T,>(data: T) => new Resp(SUCCESS_CODE, "操作成功", data);
const roleList = [
  { id: "role-admin", role_name: "管理员", role_code: "admin", description: "管理端、团员端和客户端", permissions: [{id:"system-user", perm_name:"用户管理", perm_code:"SYSTEM_USER_EDIT", description:"维护用户"}] },
  { id: "role-employee", role_name: "团员", role_code: "employee", description: "团员端和客户端", permissions: [] },
  { id: "role-common", role_name: "普通用户", role_code: "common", description: "客户端", permissions: [] },
];
interface ReviewUser {
  id: string; nickname: string; username: string; status: number;
  register_at: number; phone: string; email: string; roleIds: string[]; deleted?: boolean;
  is_bootstrap_admin: boolean;
}
export const REVIEW_ADMIN_ID = "00A0";
const key = "sky-club.admin-review.system.v2";
function initialUsers(): ReviewUser[] {
  return [
    [REVIEW_ADMIN_ID,"管理员","review_admin","role-admin"],
    ["00A1","青禾","qinghe","role-employee"],["00A2","鹿鸣","luming","role-employee"],
    ["00A3","云岫","yunxiu","role-employee"],["00A4","阿澄","acheng","role-employee"],
    ["00A5","禾川","hechuan","role-employee"],["00A6","知夏","zhixia","role-common"],
  ].map(([id,nickname,username,role], index) => ({id,nickname,username,roleIds:[role],status:1,
    is_bootstrap_admin: id === REVIEW_ADMIN_ID, phone:"",email:"",register_at:Date.UTC(2026,10,18 + index,2)}));
}
function readUsers(): ReviewUser[] {
  try { const saved = JSON.parse(localStorage.getItem(key) || "null"); if (Array.isArray(saved)) return saved; } catch { /* Private windows keep in-memory fixtures. */ }
  return initialUsers();
}
let users = readUsers();
function changeUser(id: string, update: (user: ReviewUser) => void) {
  const user = users.find(u => u.id === id);
  if (!user) throw new Error("演示用户不存在");
  update(user);
  try { localStorage.setItem(key,JSON.stringify(users)); } catch { /* Session only. */ }
}
window.addEventListener("storage", e => { if (e.key === key) users = readUsers(); });
const hydrate = (u: ReviewUser) => ({...u,roles:roleList.filter(r=>u.roleIds.includes(r.id))});
function paginate<T>(list: T[], page: number, size: number) {
  return {list:list.slice((page-1)*size,page*size), page,size,total:list.length,totalPages:Math.ceil(list.length/size)};
}
export const queryUserPage: typeof Users.queryUserPage = async ({page,size,id}) =>
  ok(paginate(users.filter(u=>!u.deleted && (id === undefined || u.id === id)).map(hydrate),page,size));
export const getUserDetail: typeof Users.getUserDetail = async id => {
  const user=users.find(u=>u.id===id);
  if (!user) throw new Error("演示用户不存在");
  return ok(hydrate(user));
};
export const toggleUserStatus: typeof Users.toggleUserStatus = async id => ok(changeUser(id,u=>{u.status=1-u.status;}));
export const updatePhone: typeof Users.updatePhone = async (id,phone) => ok(changeUser(id,u=>{u.phone=phone;}));
export const updateEmail: typeof Users.updateEmail = async (id,email) => ok(changeUser(id,u=>{u.email=email;}));
export const updateRoles: typeof Users.updateRoles = async (id,roleIds) => ok(changeUser(id,u=>{u.roleIds=[...roleIds];}));
export const resetPassword: typeof Users.resetPassword = async () => ok({password:"DEMO-"+crypto.randomUUID().slice(0,8)});
export const deleteUser: typeof Users.deleteUser = async id => ok(changeUser(id,u=>{u.deleted=true;}));
export const restoreUser: typeof Users.restoreUser = async id => ok(changeUser(id,u=>{u.deleted=false;}));
export const queryAllRoles: typeof Roles.queryAllRoles = async () => ok(roleList);
export const queryRolePage: typeof Roles.queryRolePage = async ({page,size}) => ok(paginate(roleList,page,size));
