import HomePage from './home-page';
import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/', 'home');

export default HomePage;
