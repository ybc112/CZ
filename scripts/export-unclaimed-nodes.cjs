// 导出全部 60 个已分配节点名单（含掉榜节点），供运营公告/私信使用
// 数据来源：RankRewardAllocated 事件（epoch1 分配快照）+ 实时 userInfo
const ethers = require('ethers');
const fs = require('fs');

const BANK = '0x903fcce5d67648FBE6Dccc9806e3bd7D303380fD';
const abi = [
  'function getRankedNodes(uint256 offset, uint256 limit) view returns (address[] memory nodes, uint256[] memory scores)',
  'function getUserInfo(address user) view returns (tuple(uint256 totalStaked, uint256 totalWithdrawn, uint256 stakeCount, uint256 activeStakeCount, address referrer, uint256 directReferrals, uint256 referralStakeVolume, uint256 pendingInviteRewards, uint256 totalInviteClaimed, uint256 pendingRankRewards, uint256 totalRankClaimed, uint256 lockedInviteRewards, uint256 inviteUnlockCursor) info, uint256 pendingRewards, uint256 totalClaimed, uint256 rank)',
  'function getRankedNodeCount() view returns (uint256)',
];

(async () => {
  const p = new ethers.JsonRpcProvider('https://rpc-bsc.48.club');
  const c = new ethers.Contract(BANK, abi, p);

  // 1) epoch1 分配快照（块 115036222，60 个节点）
  const t0a = ethers.id('RankRewardAllocated(uint256,address,uint256,uint256)');
  const ifaceA = new ethers.Interface(['event RankRewardAllocated(uint256 indexed epochId,address indexed node,uint256 rank,uint256 amount)']);
  const logs = await p.getLogs({ address: BANK, topics: [t0a], fromBlock: 115035900, toBlock: 115036500 });
  const alloc = logs.map(l => {
    const d = ifaceA.parseLog({ topics: l.topics, data: l.data });
    return { epoch: d.args.epochId.toString(), node: d.args.node, rank: Number(d.args.rank), amount: d.args.amount };
  }).filter(a => a.epoch === '1');

  // 2) 当前榜单（判断是否掉榜）
  const count = Number(await c.getRankedNodeCount());
  const { nodes } = await c.getRankedNodes(0, count);
  const onBoard = new Set(nodes.map(a => a.toLowerCase()));

  // 3) 逐个查账上未领余额
  const rows = [];
  let onUnclaimed = 0n, offUnclaimed = 0n;
  for (const a of alloc) {
    const isOn = onBoard.has(a.node.toLowerCase());
    const [info] = await c.getUserInfo(a.node);
    const pending = info.pendingRankRewards;
    if (isOn) onUnclaimed += pending; else offUnclaimed += pending;
    rows.push({
      rank: a.rank,
      address: a.node,
      allocated: ethers.formatEther(a.amount),
      onBoard: isOn ? '在榜' : '掉榜',
      unclaimed: ethers.formatEther(pending),
    });
  }
  rows.sort((x, y) => x.rank - y.rank);

  // 4) CSV（含 BOM，Excel 直接打开）
  const header = '排名,地址,分配金额(CZ),榜单状态,当前未领(CZ),未领状态';
  const lines = rows.map(r =>
    `${r.rank},${r.address},${r.allocated},${r.onBoard},${r.unclaimed},${parseFloat(r.unclaimed) > 0 ? '待领取' : '已领完'}`
  );
  fs.writeFileSync('scripts/unclaimed-nodes.csv', '﻿' + [header, ...lines].join('\n'), 'utf8');

  // 5) 汇总
  const unclaimed = rows.filter(r => parseFloat(r.unclaimed) > 0);
  console.log('分配节点总数:', rows.length);
  console.log('在榜节点:', rows.filter(r => r.onBoard === '在榜').length, '| 掉榜节点:', rows.filter(r => r.onBoard === '掉榜').length);
  console.log('有未领排名的节点:', unclaimed.length);
  console.log('在榜未领合计:', ethers.formatEther(onUnclaimed));
  console.log('掉榜未领合计:', ethers.formatEther(offUnclaimed));
  console.log('未领总计:', ethers.formatEther(onUnclaimed + offUnclaimed));
  console.log('\n已导出 scripts/unclaimed-nodes.csv (' + rows.length + ' 行)');
  console.log('\n--- 掉榜节点（10 个未领，重新上榜后仍可领） ---');
  for (const r of rows.filter(r => r.onBoard === '掉榜' && parseFloat(r.unclaimed) > 0)) {
    console.log(`#${r.rank} ${r.address} 未领 ${r.unclaimed}`);
  }
})().catch(e => { console.error('ERR', e.shortMessage || e.message); process.exit(1); });
