import type { MetadataRoute } from 'next';
export default function manifest():MetadataRoute.Manifest{return{name:'HospiBrain',short_name:'HospiBrain',description:'Hospitality operating system',start_url:'/dashboard',display:'standalone',background_color:'#020202',theme_color:'#020202',icons:[{src:'/window.svg',sizes:'any',type:'image/svg+xml'}]};}
