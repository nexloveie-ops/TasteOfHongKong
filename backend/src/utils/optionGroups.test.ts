import mongoose from 'mongoose';
import { cloneOptionGroupsPreservingSubdocIds, type LeanOptionGroup } from './optionGroups';

describe('cloneOptionGroupsPreservingSubdocIds', () => {
  const gid = new mongoose.Types.ObjectId();
  const cid = new mongoose.Types.ObjectId();

  const sample: LeanOptionGroup[] = [
    {
      _id: gid,
      required: true,
      translations: [{ locale: 'zh-CN', name: '规格' }],
      choices: [
        {
          _id: cid,
          translations: [{ locale: 'zh-CN', name: '大' }],
          extraPrice: 1,
        },
      ],
    },
  ];

  it('preserves existing group and choice ObjectIds across clones', () => {
    const a = cloneOptionGroupsPreservingSubdocIds(sample);
    const b = cloneOptionGroupsPreservingSubdocIds(sample);
    expect(a[0]._id?.toString()).toBe(gid.toString());
    expect(a[0].choices[0]._id?.toString()).toBe(cid.toString());
    expect(b[0]._id?.toString()).toBe(gid.toString());
  });

  it('generates new ids when missing', () => {
    const bare: LeanOptionGroup[] = [
      {
        required: false,
        translations: [{ locale: 'zh-CN', name: 'G' }],
        choices: [{ translations: [{ locale: 'zh-CN', name: 'C' }], extraPrice: 0 }],
      },
    ];
    const x = cloneOptionGroupsPreservingSubdocIds(bare);
    expect(x[0]._id).toBeDefined();
    expect(x[0].choices[0]._id).toBeDefined();
  });
});
