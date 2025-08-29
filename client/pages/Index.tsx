import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  FileText, 
  ScanLine, 
  BarChart3, 
  ArrowRight
} from "lucide-react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";

const modules = [
  {
    title: "PR Generator",
    description: "Upload BOM files and generate purchase requisitions by supplier",
    icon: FileText,
    route: "/pr-generator"
  },
  {
    title: "Document Assistant",
    description: "Scan documents and extract data with AI processing",
    icon: ScanLine,
    route: "/document-assistant"
  },
  {
    title: "Report Builder",
    description: "Complete incomplete reports by merging data from ERP systems",
    icon: BarChart3,
    route: "/report-builder"
  }
];

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-white dark:bg-transparent rounded px-2 py-1">
                <img
                  src="/cmr-logo.png"
                  alt="CMR Logo"
                  className="h-8 w-auto"
                />
              </div>
              <span className="text-xl font-semibold text-foreground">CMR Procurement</span>
            </div>
            <div className="flex items-center space-x-4">
              <nav className="hidden md:flex items-center space-x-6">
                <Link to="/pr-generator" className="text-muted-foreground hover:text-primary transition-colors">
                  PR Generator
                </Link>
                <Link to="/document-assistant" className="text-muted-foreground hover:text-primary transition-colors">
                  Document Assistant
                </Link>
                <Link to="/report-builder" className="text-muted-foreground hover:text-primary transition-colors">
                  Report Builder
                </Link>
              </nav>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-foreground mb-4">
            Process Automation
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Streamline your procurement workflows with automated document processing and reporting
          </p>
        </div>

        {/* Main Modules */}
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {modules.map((module, index) => {
            const Icon = module.icon;
            return (
              <Card key={index} className="hover:shadow-lg transition-all duration-200">
                <CardHeader className="text-center pb-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{module.title}</CardTitle>
                  <CardDescription className="text-sm">
                    {module.description}
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="pt-0">
                  <Link to={module.route}>
                    <Button className="w-full">
                      Open
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
