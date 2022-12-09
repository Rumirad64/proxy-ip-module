import {
  Schema, model, Document, PaginateModel,
} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

// 1. Create an interface representing a document in MongoDB.
export interface IProxyIp {
  ip: string;
  port: number | null;
  timestamp: Date;
  reason: string;
  hits: number;
}

// 2. Create a Schema corresponding to the document interface.

const proxyIpSchema = new Schema<IProxyIp>(
  {
    ip: {
      type: String,
      required: true,
      // ignore duplicate ip
      unique: true,
    },
    port: {
      type: Number,
      required: false,
      default: null,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    reason: {
      type: String,
      required: true,
      default: 'Unknown Detection',
    },
    hits: {
      type: Number,
      required: true,
      default: 1,
    },
  },
  {
    timestamps: true,
  },
);

// inject mongoose-paginate-v2
proxyIpSchema.plugin(mongoosePaginate);

interface ProxyIpDocument extends Document, IProxyIp {}

// Create a Model and export it

export const ProxyIp = model<ProxyIpDocument, PaginateModel<ProxyIpDocument>>('ProxyIp', proxyIpSchema);
