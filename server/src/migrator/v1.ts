import mongoose from 'mongoose';
import { Types } from 'mongoose';
import {
  PermissionType,
  PermissionStatus,
  ApiMethod,
  PermissionSchema,
} from '../modules/permission-module/permission.schema';

// 定义接口
interface PermissionData {
  perm_code: string;
  perm_name: string;
  description: string;
  type: PermissionType;
  parent_id?: Types.ObjectId | null;
  icon?: string;
  path?: string;
  component?: string;
  api_method?: ApiMethod;
  api_path?: string;
  sort_order: number;
  is_system: boolean;
  tag?: string;
}

interface RoleData {
  role_code: string;
  role_name: string;
  description: string;
  is_system: boolean;
  sort_order: number;
  permission_codes: string[];
}

// 权限数据定义
interface PermissionSeed {
  temp_id: string;           // 临时唯一标识（如 'SYSTEM', 'SYSTEM_USER'）
  perm_code: string;
  perm_name: string;
  type: PermissionType;
  parent_temp_id?: string | null;  // 临时父标识
  icon?: string;
  path?: string;
  component?: string;
  api_method?: ApiMethod;
  api_path?: string;
  description?: string;
  sort_order: number;
  is_system: boolean;
  is_visible?: boolean;
  tag?: string;
}

// 权限种子数据
const permissions: PermissionSeed[] = [
  // =====================================================
  // 1. 系统管理模块
  // =====================================================
  {
    temp_id: 'SYSTEM',
    perm_code: 'SYSTEM',
    perm_name: '系统管理',
    type: PermissionType.MENU,
    parent_temp_id: null,
    icon: 'setting',
    path: '/system',
    component: 'Layout',
    sort_order: 100,
    is_system: true,
    tag: 'system',
  },
  // 1.1 用户管理
  {
    temp_id: 'SYSTEM_USER',
    perm_code: 'SYSTEM_USER',
    perm_name: '用户管理',
    type: PermissionType.MENU,
    parent_temp_id: 'SYSTEM',  // 引用临时ID
    icon: 'user',
    path: '/system/user',
    component: 'system/user/index',
    sort_order: 1,
    is_system: true,
    tag: 'system',
  },
  {
    temp_id: 'SYSTEM_USER_VIEW',
    perm_code: 'SYSTEM_USER_VIEW',
    perm_name: '查看用户',
    description: '查看用户列表和详情',
    type: PermissionType.BUTTON,
    parent_temp_id: 'SYSTEM_USER',
    sort_order: 1,
    is_system: true,
    tag: 'system',
  },
  {
    temp_id: 'SYSTEM_USER_EDIT',
    perm_code: 'SYSTEM_USER_EDIT',
    perm_name: '编辑用户',
    description: '修改用户信息',
    type: PermissionType.BUTTON,
    parent_temp_id: 'SYSTEM_USER',
    sort_order: 2,
    is_system: true,
    tag: 'system',
  },
  {
    temp_id: 'SYSTEM_USER_DISABLE',
    perm_code: 'SYSTEM_USER_DISABLE',
    perm_name: '禁用用户',
    description: '禁用/启用用户账号',
    type: PermissionType.BUTTON,
    parent_temp_id: 'SYSTEM_USER',
    sort_order: 3,
    is_system: true,
    tag: 'system',
  },
  // 用户管理 API
  {
    temp_id: 'API_SYSTEM_USER_LIST',
    perm_code: 'API_SYSTEM_USER_LIST',
    perm_name: '查询用户列表',
    type: PermissionType.API,
    api_method: ApiMethod.GET,
    api_path: '/api/admin/users',
    parent_temp_id: 'SYSTEM_USER_VIEW',
    sort_order: 1,
    is_system: true,
    tag: 'api',
  },
  {
    temp_id: 'API_SYSTEM_USER_DETAIL',
    perm_code: 'API_SYSTEM_USER_DETAIL',
    perm_name: '查询用户详情',
    type: PermissionType.API,
    api_method: ApiMethod.GET,
    api_path: '/api/admin/users/:id',
    parent_temp_id: 'SYSTEM_USER_VIEW',
    sort_order: 2,
    is_system: true,
    tag: 'api',
  },
  {
    temp_id: 'API_SYSTEM_USER_UPDATE',
    perm_code: 'API_SYSTEM_USER_UPDATE',
    perm_name: '更新用户',
    type: PermissionType.API,
    api_method: ApiMethod.PUT,
    api_path: '/api/admin/users/:id',
    parent_temp_id: 'SYSTEM_USER_EDIT',
    sort_order: 3,
    is_system: true,
    tag: 'api',
  },
  {
    temp_id: 'API_SYSTEM_USER_DISABLE',
    perm_code: 'API_SYSTEM_USER_DISABLE',
    perm_name: '禁用用户',
    type: PermissionType.API,
    api_method: ApiMethod.PATCH,
    api_path: '/api/admin/users/:id/status',
    parent_temp_id: 'SYSTEM_USER_DISABLE',
    sort_order: 4,
    is_system: true,
    tag: 'api',
  },

  // 1.2 角色管理
  {
    temp_id: 'SYSTEM_ROLE',
    perm_code: 'SYSTEM_ROLE',
    perm_name: '角色管理',
    type: PermissionType.MENU,
    parent_temp_id: 'SYSTEM',
    icon: 'team',
    path: '/system/role',
    component: 'system/role/index',
    sort_order: 2,
    is_system: true,
    tag: 'system',
  },
  {
    temp_id: 'SYSTEM_ROLE_VIEW',
    perm_code: 'SYSTEM_ROLE_VIEW',
    perm_name: '查看角色',
    type: PermissionType.BUTTON,
    parent_temp_id: 'SYSTEM_ROLE',
    sort_order: 1,
    is_system: true,
    tag: 'system',
  },
  {
    temp_id: 'SYSTEM_ROLE_EDIT',
    perm_code: 'SYSTEM_ROLE_EDIT',
    perm_name: '编辑角色',
    type: PermissionType.BUTTON,
    parent_temp_id: 'SYSTEM_ROLE',
    sort_order: 2,
    is_system: true,
    tag: 'system',
  },

  // =====================================================
  // 2. 内容管理模块
  // =====================================================
  {
    temp_id: 'CONTENT',
    perm_code: 'CONTENT',
    perm_name: '内容管理',
    type: PermissionType.MENU,
    parent_temp_id: null,
    icon: 'file-text',
    path: '/content',
    component: 'Layout',
    sort_order: 200,
    is_system: true,
    tag: 'content',
  },
  // 2.1 动态管理
  {
    temp_id: 'CONTENT_MOMENT',
    perm_code: 'CONTENT_MOMENT',
    perm_name: '动态管理',
    type: PermissionType.MENU,
    parent_temp_id: 'CONTENT',
    icon: 'camera',
    path: '/content/moment',
    component: 'content/moment/index',
    sort_order: 1,
    is_system: true,
    tag: 'content',
  },
  {
    temp_id: 'CONTENT_MOMENT_VIEW',
    perm_code: 'CONTENT_MOMENT_VIEW',
    perm_name: '查看动态',
    description: '查看动态列表和详情',
    type: PermissionType.BUTTON,
    parent_temp_id: 'CONTENT_MOMENT',
    sort_order: 1,
    is_system: true,
    tag: 'content',
  },
  {
    temp_id: 'CONTENT_MOMENT_AUDIT',
    perm_code: 'CONTENT_MOMENT_AUDIT',
    perm_name: '审核动态',
    description: '审核通过/拒绝动态',
    type: PermissionType.BUTTON,
    parent_temp_id: 'CONTENT_MOMENT',
    sort_order: 2,
    is_system: true,
    tag: 'content',
  },
  {
    temp_id: 'CONTENT_MOMENT_EDIT',
    perm_code: 'CONTENT_MOMENT_EDIT',
    perm_name: '编辑动态',
    description: '编辑动态内容（运营专员可用）',
    type: PermissionType.BUTTON,
    parent_temp_id: 'CONTENT_MOMENT',
    sort_order: 3,
    is_system: true,
    tag: 'content',
  },
  {
    temp_id: 'CONTENT_MOMENT_DELETE',
    perm_code: 'CONTENT_MOMENT_DELETE',
    perm_name: '删除动态',
    description: '删除违规动态（仅管理员）',
    type: PermissionType.BUTTON,
    parent_temp_id: 'CONTENT_MOMENT',
    sort_order: 4,
    is_system: true,
    tag: 'content',
  },
  // 动态管理 API
  {
    temp_id: 'API_CONTENT_MOMENT_LIST',
    perm_code: 'API_CONTENT_MOMENT_LIST',
    perm_name: '查询动态列表',
    type: PermissionType.API,
    api_method: ApiMethod.GET,
    api_path: '/api/admin/moments',
    parent_temp_id: 'CONTENT_MOMENT_VIEW',
    sort_order: 1,
    is_system: true,
    tag: 'api',
  },
  {
    temp_id: 'API_CONTENT_MOMENT_AUDIT',
    perm_code: 'API_CONTENT_MOMENT_AUDIT',
    perm_name: '审核动态',
    type: PermissionType.API,
    api_method: ApiMethod.PATCH,
    api_path: '/api/admin/moments/:id/audit',
    parent_temp_id: 'CONTENT_MOMENT_AUDIT',
    sort_order: 2,
    is_system: true,
    tag: 'api',
  },
  {
    temp_id: 'API_CONTENT_MOMENT_UPDATE',
    perm_code: 'API_CONTENT_MOMENT_UPDATE',
    perm_name: '更新动态',
    type: PermissionType.API,
    api_method: ApiMethod.PUT,
    api_path: '/api/admin/moments/:id',
    parent_temp_id: 'CONTENT_MOMENT_EDIT',
    sort_order: 3,
    is_system: true,
    tag: 'api',
  },
  {
    temp_id: 'API_CONTENT_MOMENT_DELETE',
    perm_code: 'API_CONTENT_MOMENT_DELETE',
    perm_name: '删除动态',
    type: PermissionType.API,
    api_method: ApiMethod.DELETE,
    api_path: '/api/admin/moments/:id',
    parent_temp_id: 'CONTENT_MOMENT_DELETE',
    sort_order: 4,
    is_system: true,
    tag: 'api',
  },

  // =====================================================
  // 3. 数据管理模块
  // =====================================================
  {
    temp_id: 'DATA',
    perm_code: 'DATA',
    perm_name: '数据管理',
    type: PermissionType.MENU,
    parent_temp_id: null,
    icon: 'database',
    path: '/data',
    component: 'Layout',
    sort_order: 300,
    is_system: true,
    tag: 'data',
  },
  // 3.1 数据统计（运营专员主要看这个）
  {
    temp_id: 'DATA_STATISTICS',
    perm_code: 'DATA_STATISTICS',
    perm_name: '数据统计',
    type: PermissionType.MENU,
    parent_temp_id: 'DATA',
    icon: 'bar-chart',
    path: '/data/statistics',
    component: 'data/statistics/index',
    sort_order: 1,
    is_system: true,
    tag: 'data',
  },
  {
    temp_id: 'DATA_STATISTICS_VIEW',
    perm_code: 'DATA_STATISTICS_VIEW',
    perm_name: '查看统计',
    type: PermissionType.BUTTON,
    parent_temp_id: 'DATA_STATISTICS',
    sort_order: 1,
    is_system: true,
    tag: 'data',
  },
  {
    temp_id: 'DATA_STATISTICS_EXPORT',
    perm_code: 'DATA_STATISTICS_EXPORT',
    perm_name: '导出统计',
    type: PermissionType.BUTTON,
    parent_temp_id: 'DATA_STATISTICS',
    sort_order: 2,
    is_system: true,
    tag: 'data',
  },
  // 3.2 数据备份（仅运维）
  {
    temp_id: 'DATA_BACKUP',
    perm_code: 'DATA_BACKUP',
    perm_name: '数据备份',
    type: PermissionType.MENU,
    parent_temp_id: 'DATA',
    icon: 'cloud-upload',
    path: '/data/backup',
    component: 'data/backup/index',
    sort_order: 2,
    is_system: true,
    tag: 'data',
  },
  {
    temp_id: 'DATA_BACKUP_VIEW',
    perm_code: 'DATA_BACKUP_VIEW',
    perm_name: '查看备份',
    type: PermissionType.BUTTON,
    parent_temp_id: 'DATA_BACKUP',
    sort_order: 1,
    is_system: true,
    tag: 'data',
  },
  {
    temp_id: 'DATA_BACKUP_EXECUTE',
    perm_code: 'DATA_BACKUP_EXECUTE',
    perm_name: '执行备份',
    type: PermissionType.BUTTON,
    parent_temp_id: 'DATA_BACKUP',
    sort_order: 2,
    is_system: true,
    tag: 'data',
  },
  // 3.3 数据清理（仅运维）
  {
    temp_id: 'DATA_CLEAN',
    perm_code: 'DATA_CLEAN',
    perm_name: '数据清理',
    type: PermissionType.MENU,
    parent_temp_id: 'DATA',
    icon: 'delete',
    path: '/data/clean',
    component: 'data/clean/index',
    sort_order: 3,
    is_system: true,
    tag: 'data',
  },
  {
    temp_id: 'DATA_CLEAN_VIEW',
    perm_code: 'DATA_CLEAN_VIEW',
    perm_name: '查看清理',
    type: PermissionType.BUTTON,
    parent_temp_id: 'DATA_CLEAN',
    sort_order: 1,
    is_system: true,
    tag: 'data',
  },
  {
    temp_id: 'DATA_CLEAN_EXECUTE',
    perm_code: 'DATA_CLEAN_EXECUTE',
    perm_name: '执行清理',
    type: PermissionType.BUTTON,
    parent_temp_id: 'DATA_CLEAN',
    sort_order: 2,
    is_system: true,
    tag: 'data',
  },

  // =====================================================
  // 4. 系统监控模块
  // =====================================================
  {
    temp_id: 'MONITOR',
    perm_code: 'MONITOR',
    perm_name: '系统监控',
    type: PermissionType.MENU,
    parent_temp_id: null,
    icon: 'dashboard',
    path: '/monitor',
    component: 'Layout',
    sort_order: 400,
    is_system: true,
    tag: 'monitor',
  },
  {
    temp_id: 'MONITOR_SERVER',
    perm_code: 'MONITOR_SERVER',
    perm_name: '服务器监控',
    type: PermissionType.MENU,
    parent_temp_id: 'MONITOR',
    path: '/monitor/server',
    component: 'monitor/server/index',
    sort_order: 1,
    is_system: true,
    tag: 'monitor',
  },
  {
    temp_id: 'MONITOR_DATABASE',
    perm_code: 'MONITOR_DATABASE',
    perm_name: '数据库监控',
    type: PermissionType.MENU,
    parent_temp_id: 'MONITOR',
    path: '/monitor/database',
    component: 'monitor/database/index',
    sort_order: 2,
    is_system: true,
    tag: 'monitor',
  },
  {
    temp_id: 'MONITOR_LOG',
    perm_code: 'MONITOR_LOG',
    perm_name: '日志监控',
    type: PermissionType.MENU,
    parent_temp_id: 'MONITOR',
    path: '/monitor/log',
    component: 'monitor/log/index',
    sort_order: 3,
    is_system: true,
    tag: 'monitor',
  },

  // =====================================================
  // 5. API 管理模块（开发用）
  // =====================================================
  {
    temp_id: 'API_MANAGE',
    perm_code: 'API_MANAGE',
    perm_name: 'API管理',
    type: PermissionType.MENU,
    parent_temp_id: null,
    icon: 'api',
    path: '/api',
    component: 'api/index',
    sort_order: 500,
    is_system: true,
    tag: 'system',
  },

  // =====================================================
  // 6. 应用端权限（C端用户）
  // =====================================================
  {
    temp_id: 'APP_MOMENT',
    perm_code: 'APP_MOMENT',
    perm_name: '动态功能',
    type: PermissionType.MENU,
    parent_temp_id: null,
    is_system: false,
    sort_order: 1000,
    tag: 'app',
  },
  {
    temp_id: 'APP_MOMENT_CREATE',
    perm_code: 'APP_MOMENT_CREATE',
    perm_name: '发布动态',
    type: PermissionType.BUTTON,
    parent_temp_id: 'APP_MOMENT',
    sort_order: 1,
    is_system: false,
    tag: 'app',
  },
  {
    temp_id: 'APP_MOMENT_LIKE',
    perm_code: 'APP_MOMENT_LIKE',
    perm_name: '点赞动态',
    type: PermissionType.BUTTON,
    parent_temp_id: 'APP_MOMENT',
    sort_order: 2,
    is_system: false,
    tag: 'app',
  },
  {
    temp_id: 'APP_MOMENT_COMMENT',
    perm_code: 'APP_MOMENT_COMMENT',
    perm_name: '评论动态',
    type: PermissionType.BUTTON,
    parent_temp_id: 'APP_MOMENT',
    sort_order: 3,
    is_system: false,
    tag: 'app',
  },
  {
    temp_id: 'APP_MOMENT_SHARE',
    perm_code: 'APP_MOMENT_SHARE',
    perm_name: '分享动态',
    type: PermissionType.BUTTON,
    parent_temp_id: 'APP_MOMENT',
    sort_order: 4,
    is_system: false,
    tag: 'app',
  },
  // C端 API
  {
    temp_id: 'API_APP_MOMENT_CREATE',
    perm_code: 'API_APP_MOMENT_CREATE',
    perm_name: '创建动态',
    type: PermissionType.API,
    api_method: ApiMethod.POST,
    api_path: '/api/moments',
    parent_temp_id: 'APP_MOMENT_CREATE',
    sort_order: 1,
    is_system: false,
    tag: 'api',
  },
];

async function initializePermissions(
  permissionModel: any, // 你的 Permission Mongoose Model
) {
  // 1. 按层级排序（确保父级先创建）
  const sortedSeeds = sortByHierarchy(permissions);

  // 2. 创建权限并建立 ID 映射
  const tempIdToObjectId = new Map<string, Types.ObjectId>();

  for (const seed of sortedSeeds) {
    // 获取父级 ObjectId（如果存在）
    let parent_id: Types.ObjectId | null = null;
    if (seed.parent_temp_id) {
      parent_id = tempIdToObjectId.get(seed.parent_temp_id) || null;
    }

    // 检查是否已存在（通过 perm_code 唯一性）
    let permission = await permissionModel.findOne({
      perm_code: seed.perm_code,
      deleted_at: null,
    });

    if (!permission) {
      // 创建新权限
      const permissionData = {
        perm_code: seed.perm_code,
        perm_name: seed.perm_name,
        type: seed.type,
        parent_id: parent_id,
        description: seed.description || '',
        icon: seed.icon || '',
        path: seed.path || '',
        component: seed.component || '',
        api_method: seed.api_method || null,
        api_path: seed.api_path || '',
        sort_order: seed.sort_order,
        status: PermissionStatus.ENABLED,
        is_system: seed.is_system,
        is_visible: seed.is_visible !== false, // 默认 true
        tag: seed.tag || '',
      };

      permission = await permissionModel.create(permissionData);
      console.log(`✅ 创建权限: ${seed.perm_code}`);
    } else {
      // 更新父级关系（如果变化了）
      if (String(permission.parent_id) !== String(parent_id)) {
        permission.parent_id = parent_id;
        await permission.save();
        console.log(`📝 更新权限父级: ${seed.perm_code}`);
      } else {
        console.log(`⏭️  权限已存在: ${seed.perm_code}`);
      }
    }

    // 保存 temp_id 到 ObjectId 的映射
    tempIdToObjectId.set(seed.temp_id, permission._id);
  }

  console.log(`\n🎉 权限初始化完成，共 ${tempIdToObjectId.size} 个权限`);
  return tempIdToObjectId;
}

// 辅助函数：按层级排序（拓扑排序）
function sortByHierarchy(seeds: PermissionSeed[]): PermissionSeed[] {
  const tempIdMap = new Map(seeds.map(s => [s.temp_id, s]));
  const visited = new Set<string>();
  const result: PermissionSeed[] = [];

  function visit(seed: PermissionSeed) {
    if (visited.has(seed.temp_id)) return;

    // 先访问父级
    if (seed.parent_temp_id && tempIdMap.has(seed.parent_temp_id)) {
      const parent = tempIdMap.get(seed.parent_temp_id)!;
      visit(parent);
    }

    visited.add(seed.temp_id);
    result.push(seed);
  }

  seeds.forEach(seed => visit(seed));
  return result;
}

export async function v1() {
  const PermissionModel = mongoose.model('Permission', PermissionSchema);
  await initializePermissions(PermissionModel);
}
