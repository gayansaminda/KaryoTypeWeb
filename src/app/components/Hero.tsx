import { Button } from "./ui/button";
import { ArrowRight, Microscope, Menu } from "lucide-react";
import {ImageWithFallback} from "./figma/ImageWithFallback";
import { useNavigate } from "react-router-dom";
import heroImage from "../../assets/MonitorView.png"

export function Hero() {

  const navigate = useNavigate();

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-blue-900 to-blue-950 ">
      {/* Navigation */}


      {/* Hero Content */}
      <div className="container mx-auto px-6 py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <div className="inline-block">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                <span className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                AI-Powered Genetic Analysis
              </span>
            </div>
            
            <h1 className="text-5xl lg:text-6xl font-bold text-white leading-tight">
              Advanced Karyotyping for{" "}
              <span className="text-blue-600">Precise Diagnosis</span>
            </h1>
            
            <p className="text-xl text-white leading-relaxed">
              Detect genetic abnormalities with confidence using our AI-powered karyotyping software. 
              Supporting both Banding and FISH analysis with automated chromosome segmentation and classification.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <Button size="lg" className="text-base group" onClick={() => navigate("/online-karyotyping")}>
                Online Demo
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button size="lg" variant="outline" className="text-base" onClick={()=>navigate("/video")}>
                Watch Demo
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-8 pt-8 border-t border-gray-200">
              <div>
                <div className="text-3xl font-bold text-white">90.2%</div>
                <div className="text-sm text-white">Accuracy Rate</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white">50%</div>
                <div className="text-sm text-white">Time Saved</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white">500+</div>
                <div className="text-sm text-white">Labs Using</div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <ImageWithFallback
                src={heroImage}
                alt="Medical laboratory microscope"
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-blue-900/20 to-transparent"></div>
            </div>
            
            {/* Floating cards */}
           
       
         

            <div className="absolute -top-6 -right-6 bg-white rounded-xl shadow-xl p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">AI Powered</div>
                  <div className="text-xs text-gray-600">Real-time processing</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
