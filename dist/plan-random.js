// Reproducible random stream for a saved staff-only recommendation plan.
// ChaCha20 block function, RFC 8439 section 2.3. Fresh 256-bit keys come from
// Web Crypto; the nonce is fixed because each plan uses an independent key.
export function planSeed(){return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(8)));}
export function chachaBlock(key,counter=0,nonce=[0,0,0]){
 const input=new Uint32Array([0x61707865,0x3320646e,0x79622d32,0x6b206574,...key,counter,...nonce]);
 const x=new Uint32Array(input),rot=(n,b)=>(n<<b)|(n>>>(32-b));
 const q=(a,b,c,d)=>{
  x[a]+=x[b];x[d]=rot(x[d]^x[a],16);x[c]+=x[d];x[b]=rot(x[b]^x[c],12);
  x[a]+=x[b];x[d]=rot(x[d]^x[a],8);x[c]+=x[d];x[b]=rot(x[b]^x[c],7);
 };
 for(let i=0;i<10;i++){
  q(0,4,8,12);q(1,5,9,13);q(2,6,10,14);q(3,7,11,15);
  q(0,5,10,15);q(1,6,11,12);q(2,7,8,13);q(3,4,9,14);
 }
 return Array.from(x,(word,i)=>(word+input[i])>>>0);
}
export function planRandom(seed,offset=0){
 if(!Array.isArray(seed)||seed.length!==8||!seed.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff))throw new Error('Invalid plan seed');
 if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid random position');
 const key=seed.slice();let position=offset,blockCounter=-1,block;
 const random=()=>{const counter=Math.floor(position/16);if(counter>0xffffffff)throw new Error('Plan random stream exhausted');if(counter!==blockCounter){block=chachaBlock(key,counter);blockCounter=counter;}return block[position++%16]/4294967296;};
 Object.defineProperty(random,'position',{get:()=>position});return random;
}
