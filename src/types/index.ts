export declare namespace App {
  export type Booking = {
    id: number;
    sid: number;
    title: string;
    date: string;
    banban: string;
    paipai: string;
    zhipai: string;
    status: string;
    total: number;
    yingchu: number;
    richu: number;
    yichu: string;
    jinriYichu: string;
    jinriStatus: string;
    gongzi: string;
    yuqiJiesuan: string;
    shijiJiesuan: string;
    jiesuo: number;
    yishan: number;
    pingbi: number;
    xiaoqun: string;
    remark: string;
    pinglun: string;
    created_at: string;
    updated_at: string;
  }
}

export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
