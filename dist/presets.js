import {initialState,emptyBook,emptyEgg,addItem,eggAddItem} from './core.js';
export const DISMANTLE_ITEMS=['T恤','红娃衣','黑娃衣','扑克','拼图','磁吸支架','掼蛋','便利贴','冰箱贴','盆栽','鼠标垫'];
export const PLACEMENT_ITEMS=['鼠标垫','盆栽','便利贴','冰箱贴','拼图','扑克','掼蛋','娃衣','磁吸支架','T恤'];
export function freshAccountState(){
 const state=initialState();for(const kind of ['sales','stock']){state[kind]=emptyBook(kind);for(const name of DISMANTLE_ITEMS)addItem(state[kind],name);}
 state.egg=emptyEgg();for(const name of PLACEMENT_ITEMS)eggAddItem(state.egg,name,1);return state;
}
