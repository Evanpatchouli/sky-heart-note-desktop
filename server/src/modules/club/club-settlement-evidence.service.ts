import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { GiftSettlementReference } from '@sky-club/common';
import { createHash } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { isDuplicateKey } from '../user-module/user-id';
import { ClubSettlementCalculation, ClubSettlementEvidence } from './club-settlement.schema';

type Metadata = Pick<ClubSettlementCalculation, '_id' | 'version' | 'calculatedAt'>;
const selectMetadata = { _id: 1, version: 1, calculatedAt: 1 };
const chunkSize = 1024 * 1024;
const durable = { w: 'majority', j: true } as const;

function hash(version: number, source: Buffer) {
  return createHash('sha256').update(`${version}:`).update(source).digest('hex');
}

export function settlementReference(record?: Metadata | null): GiftSettlementReference | null {
  return record ? { id: record._id, version: record.version, calculatedAt: record.calculatedAt.toISOString() } : null;
}

@Injectable()
export class ClubSettlementEvidenceService {
  constructor(
    @InjectModel(ClubSettlementCalculation.name) private readonly calculations: Model<ClubSettlementCalculation>,
    @InjectModel(ClubSettlementEvidence.name) private readonly evidence: Model<ClubSettlementEvidence>,
  ) {}

  async latest(clubId: string, orderId: Types.ObjectId, exclude?: string, before?: Date) {
    return settlementReference(await this.calculations.findOne({
      clubId, orderId, ...(exclude ? { _id: { $ne: exclude } } : {}), ...(before ? { calculatedAt: { $lt: before } } : {}),
    }).select(selectMetadata).sort({ calculatedAt: -1, _id: -1 }).lean());
  }

  async read<T>(clubId: string, orderId: Types.ObjectId, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new BadRequestException('计算单标识格式无效');
    const saved = await this.calculations.findOne({ _id: id, clubId, orderId }).lean();
    if (!saved) throw new NotFoundException('该计算单不存在');
    const chunks = await this.evidence.find({ calculationId: id }).sort({ sequence: 1 });
    if (chunks.length !== saved.chunkCount || chunks.some((chunk, index) => chunk.sequence !== index))
      throw new InternalServerErrorException('计算单依据缺失');
    const source = Buffer.concat(chunks.map(chunk => chunk.bytes));
    if (hash(saved.version, source) !== id) throw new InternalServerErrorException('计算单依据校验失败');
    return { calculation: JSON.parse(source.toString('utf8')) as T, finalCalculation: settlementReference(saved)! };
  }

  async save(clubId: string, orderId: Types.ObjectId, version: number, calculation: object) {
    const source = Buffer.from(JSON.stringify(calculation), 'utf8');
    const id = hash(version, source);
    const key = { _id: id, clubId, orderId };
    const existing = await this.calculations.findOne(key).select(selectMetadata).lean();
    if (existing) return settlementReference(existing);
    const chunkCount = Math.ceil(source.length / chunkSize);
    // The header is published after all evidence is durable, even on standalone MongoDB.
    for (let sequence = 0; sequence < chunkCount; sequence++) {
      const bytes = source.subarray(sequence * chunkSize, (sequence + 1) * chunkSize);
      try {
        await new this.evidence({ _id: `${id}:${sequence}`, calculationId: id, sequence, bytes }).save(durable);
      } catch (error) {
        if (!isDuplicateKey(error, '_id')) throw error;
      }
    }
    try {
      return settlementReference(await new this.calculations({ ...key, version, calculatedAt: new Date(), chunkCount }).save(durable));
    } catch (error) {
      if (!isDuplicateKey(error, '_id')) throw error;
      const saved = await this.calculations.findOne(key).select(selectMetadata).lean();
      if (!saved) throw error;
      return settlementReference(saved);
    }
  }
}
