export function canonicalUsername(value){
 if(typeof value!=='string')throw new Error('请输入用户名。');
 const name=value.trim().normalize('NFKC').toLowerCase();
 if(!/^[a-z0-9_]{3,24}$/.test(name))throw new Error('用户名用 3–24 位字母、数字或下划线。');
 return name;
}
export function checkPassword(value){
 if(typeof value!=='string'||value.length<6||value.length>128)throw new Error('密码需 6–128 位，可以使用数字、字母或其他字符。');
 return value;
}
export async function sha256(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function accountAddress(name){return 'u'+await sha256(canonicalUsername(name))+'@users.little-tally.invalid';}
